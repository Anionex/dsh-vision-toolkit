import { afterEach, describe, expect, it, vi } from 'vitest'

import worker from '../src/index'
import { CANONICAL_MODEL } from '../src/protocol'

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const publicApiKey = 'https://agent-vision.anionex.me'

class FakeStatement {
  private values: unknown[] = []

  constructor(private readonly database: FakeD1, readonly sql: string) {}

  bind(...values: unknown[]): FakeStatement {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
    const key = String(this.values[1])
    const count = (this.database.counts.get(key) ?? 0) + 1
    this.database.counts.set(key, count)
    return { request_count: count } as T
  }

  async run(): Promise<D1Result<unknown>> {
    if (this.sql.includes('WHERE day < ?1')) {
      this.database.cleanupRuns += 1
      return { meta: {} } as D1Result<unknown>
    }

    const key = String(this.values[1])
    const count = this.database.counts.get(key) ?? 0
    if (this.sql.includes('request_count = 1') && count === 1) {
      this.database.counts.delete(key)
    }
    if (this.sql.includes('request_count - 1') && count > 1) {
      this.database.counts.set(key, count - 1)
    }
    if (this.sql.includes('request_count - 1') && count === 1) {
      throw new Error('CHECK constraint failed: request_count > 0')
    }
    return { meta: {} } as D1Result<unknown>
  }
}

class FakeD1 {
  cleanupRuns = 0
  readonly counts = new Map<string, number>()

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql)
  }

  async batch(statements: FakeStatement[]): Promise<D1Result<unknown>[]> {
    const snapshot = new Map(this.counts)
    try {
      return await Promise.all(statements.map(statement => statement.run()))
    } catch (error) {
      this.counts.clear()
      for (const [key, count] of snapshot) this.counts.set(key, count)
      throw error
    }
  }
}

function request(image = tinyPng, body?: BodyInit, apiKey = publicApiKey): Request {
  return new Request('https://vision.example/v1/chat/completions', {
    body: body ?? JSON.stringify({
      messages: [{
        content: [
          { text: 'Describe this image.', type: 'text' },
          { image_url: { url: image }, type: 'image_url' },
        ],
        role: 'user',
      }],
      model: CANONICAL_MODEL,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      'cf-connecting-ip': '203.0.113.10',
      'content-type': 'application/json',
    },
    method: 'POST',
    ...body instanceof ReadableStream ? { duplex: 'half' } : {},
  } as RequestInit)
}

function environment(database: FakeD1, burstSuccess = true): Env {
  return {
    BURST_LIMITER: { limit: vi.fn(async () => ({ success: burstSuccess })) },
    DAILY_LIMIT: '100',
    GLOBAL_DAILY_LIMIT: '5000',
    IP_HASH_SECRET: '0123456789abcdef0123456789abcdef',
    MAX_IMAGE_BYTES: '4194304',
    MAX_IMAGE_PIXELS: '20000000',
    MAX_OUTPUT_TOKENS: '4096',
    MAX_REQUEST_BYTES: '33554432',
    LEGACY_PUBLIC_API_KEY: 'free',
    PUBLIC_API_KEY: publicApiKey,
    GROQ_API_KEY_1: 'test-groq-key-1',
    GROQ_API_KEY_2: 'test-groq-key-2',
    GROQ_API_KEY_3: 'test-groq-key-3',
    GROQ_API_KEY_4: 'test-groq-key-4',
    GROQ_API_KEY_5: 'test-groq-key-5',
    USAGE_DB: database,
  } as Env
}

afterEach(() => vi.unstubAllGlobals())

describe('Worker request accounting', () => {
  it('advertises the branded public key on the discovery route', async () => {
    const response = await worker.fetch(
      new Request('https://vision.example/'),
      environment(new FakeD1()),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      api_key: publicApiKey,
      base_url: 'https://vision.example/v1',
      model: CANONICAL_MODEL,
    })
  })

  it('calls Groq with an OpenAI vision message and returns its text', async () => {
    const database = new FakeD1()
    const waitUntil = vi.fn()
    const context = { waitUntil } as unknown as ExecutionContext
    const groqFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: expect.stringMatching(/^Bearer test-groq-key-[1-5]$/) })
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.model).toBe(CANONICAL_MODEL)
      expect(body.reasoning_effort).toBe('none')
      expect(body).not.toHaveProperty('chat_template_kwargs')
      return Response.json({
      choices: [{
        finish_reason: 'stop',
        message: { content: 'A one-pixel test image.', role: 'assistant' },
      }],
      usage: { completion_tokens: 5, prompt_tokens: 12, total_tokens: 17 },
      })
    })
    vi.stubGlobal('fetch', groqFetch)
    const response = await worker.fetch(request(), environment(database), context)
    expect(response.status).toBe(200)
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      choices: [{ message: { content: 'A one-pixel test image.' } }],
      model: CANONICAL_MODEL,
      usage: { completion_tokens: 5, prompt_tokens: 12, total_tokens: 17 },
    })
    expect(groqFetch).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(database.cleanupRuns).toBe(1)
    const body = JSON.parse(String(groqFetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      messages: [{
        content: [
          { text: 'User: Describe this image.', type: 'text' },
          { image_url: { url: tinyPng }, type: 'image_url' },
        ],
        role: 'user',
      }],
      max_tokens: 4096,
      stream: false,
    })
  })

  it('honors smaller token budgets and caps larger requests at the upstream detect budget', async () => {
    const database = new FakeD1()
    const forwarded: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { max_tokens: number }
      forwarded.push(body.max_tokens)
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: 'ok', role: 'assistant' } }],
      })
    }))

    const lower = await worker.fetch(request(tinyPng, JSON.stringify({
      max_tokens: 1024,
      messages: [{
        content: [
          { text: 'Describe this image.', type: 'text' },
          { image_url: { url: tinyPng }, type: 'image_url' },
        ],
        role: 'user',
      }],
      model: CANONICAL_MODEL,
    })), environment(database))
    const capped = await worker.fetch(request(tinyPng, JSON.stringify({
      max_tokens: 16_384,
      messages: [{
        content: [
          { text: 'Detect every visible element.', type: 'text' },
          { image_url: { url: tinyPng }, type: 'image_url' },
        ],
        role: 'user',
      }],
      model: CANONICAL_MODEL,
    })), environment(database))

    expect(lower.status).toBe(200)
    expect(capped.status).toBe(200)
    expect(forwarded).toEqual([1024, 4096])
  })

  it('materializes and forwards multiple images in one Groq request', async () => {
    const database = new FakeD1()
    const groqFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: unknown[] }>
      }
      expect(body.messages[0]?.content).toEqual([
        { text: 'User: Compare these images.', type: 'text' },
        { image_url: { url: tinyPng }, type: 'image_url' },
        { image_url: { url: tinyPng }, type: 'image_url' },
      ])
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: 'They match.', role: 'assistant' } }],
      })
    })
    vi.stubGlobal('fetch', groqFetch)
    const response = await worker.fetch(request(tinyPng, JSON.stringify({
      messages: [{
        content: [
          { text: 'Compare these images.', type: 'text' },
          { image_url: { url: tinyPng }, type: 'image_url' },
          { image_url: { url: tinyPng }, type: 'image_url' },
        ],
        role: 'user',
      }],
      model: CANONICAL_MODEL,
    })), environment(database))

    expect(response.status).toBe(200)
    expect(groqFetch).toHaveBeenCalledTimes(1)
  })

  it('tries the next Groq key when the selected account is rate limited', async () => {
    const database = new FakeD1()
    const groqFetch = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '7' } }))
      .mockResolvedValueOnce(Response.json({
        choices: [{ finish_reason: 'stop', message: { content: 'Recovered.', role: 'assistant' } }],
      }))
    vi.stubGlobal('fetch', groqFetch)
    const response = await worker.fetch(request(), environment(database))
    expect(response.status).toBe(200)
    expect(groqFetch).toHaveBeenCalledTimes(2)
    const firstAuth = String(groqFetch.mock.calls[0]?.[1]?.headers && new Headers(groqFetch.mock.calls[0]?.[1]?.headers).get('authorization'))
    const secondAuth = String(groqFetch.mock.calls[1]?.[1]?.headers && new Headers(groqFetch.mock.calls[1]?.[1]?.headers).get('authorization'))
    expect(firstAuth).not.toBe(secondAuth)
  })

  it('keeps the legacy free API key working during the public key migration', async () => {
    const database = new FakeD1()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      choices: [{ finish_reason: 'stop', message: { content: 'Legacy key accepted.', role: 'assistant' } }],
    })))

    const response = await worker.fetch(request(tinyPng, undefined, 'free'), environment(database))
    expect(response.status).toBe(200)
  })

  it('advertises the branded public API key when authentication fails', async () => {
    const database = new FakeD1()
    const response = await worker.fetch(request(tinyPng, undefined, 'wrong-key'), environment(database))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'invalid_api_key',
        message: `Use api_key="${publicApiKey}" for this public endpoint`,
      },
    })
  })

  it('returns a sanitized upstream error when all Groq accounts are rate limited', async () => {
    const database = new FakeD1()
    const groqFetch = vi.fn(async () => new Response('rate limited', { status: 429 }))
    vi.stubGlobal('fetch', groqFetch)
    const response = await worker.fetch(request(), environment(database))
    expect(response.status).toBe(429)
    const payload = await response.json()
    expect(payload).toMatchObject({
      error: { code: 'upstream_rate_limit_exceeded' },
    })
    expect(groqFetch).toHaveBeenCalledTimes(5)
    expect(JSON.stringify(payload)).not.toContain('test-groq-key')
  })

  it('returns Groq image validation details without retrying every account', async () => {
    const database = new FakeD1()
    const groqFetch = vi.fn(async () => Response.json({
      error: {
        message: 'Image must have at least 2 pixels in each dimension',
        type: 'invalid_request_error',
      },
    }, { status: 400 }))
    vi.stubGlobal('fetch', groqFetch)

    const response = await worker.fetch(request(), environment(database))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'upstream_invalid_request',
        message: 'Vision provider rejected the request: Image must have at least 2 pixels in each dimension',
      },
    })
    expect(groqFetch).toHaveBeenCalledTimes(1)
  })

  it('redacts provider credentials from an upstream validation message', async () => {
    const database = new FakeD1()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: {
        message: 'Invalid Bearer test-groq-key-1 and gsk_exampleSecretValue',
        type: 'invalid_request_error',
      },
    }, { status: 400 })))

    const response = await worker.fetch(request(), environment(database))
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload).toMatchObject({ error: { code: 'upstream_invalid_request' } })
    expect(JSON.stringify(payload)).not.toContain('test-groq-key')
    expect(JSON.stringify(payload)).not.toContain('gsk_exampleSecretValue')
    expect(JSON.stringify(payload)).toContain('[REDACTED]')
  })

  it('maps an upstream payload limit to a descriptive 413 response', async () => {
    const database = new FakeD1()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: { message: 'The request exceeds the image payload limit' },
    }, { status: 413 })))

    const response = await worker.fetch(request(), environment(database))
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'upstream_request_too_large',
        message: 'Vision provider rejected the request because it is too large: The request exceeds the image payload limit',
      },
    })
  })

  it('applies burst limiting before reading the request body', async () => {
    let bodyRead = false
    const incoming = request()
    const body = incoming.body
    Object.defineProperty(incoming, 'body', {
      configurable: true,
      get() {
        bodyRead = true
        return body
      },
    })
    const database = new FakeD1()
    const response = await worker.fetch(incoming, environment(database, false))
    expect(response.status).toBe(429)
    expect(bodyRead).toBe(false)
    expect(database.counts.size).toBe(0)
  })

  it('keeps the daily quota reservation after inference has started', async () => {
    const database = new FakeD1()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('upstream unavailable') }))
    const response = await worker.fetch(request(), environment(database))
    expect(response.status).toBe(502)
    expect([...database.counts.values()]).toEqual([1, 1])
  })

  it('releases the daily quota when image validation fails before inference', async () => {
    const database = new FakeD1()
    const response = await worker.fetch(
      request('data:image/png;base64,iVBORw0KGgo='),
      environment(database),
    )
    expect(response.status).toBe(400)
    expect(database.counts.size).toBe(0)
  })
})
