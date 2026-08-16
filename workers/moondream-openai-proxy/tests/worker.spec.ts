import { afterEach, describe, expect, it, vi } from 'vitest'

import worker from '../src/index'
import { CANONICAL_MODEL } from '../src/protocol'

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

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
    return { meta: {} } as D1Result<unknown>
  }

  release(): void {
    const key = String(this.values[1])
    const count = this.database.counts.get(key) ?? 0
    if (this.sql.includes('request_count = 1') && count === 1) this.database.counts.delete(key)
    if (this.sql.includes('request_count > 1') && count > 1) this.database.counts.set(key, count - 1)
  }
}

class FakeD1 {
  readonly counts = new Map<string, number>()

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql)
  }

  async batch(statements: FakeStatement[]): Promise<D1Result<unknown>[]> {
    for (const statement of statements) statement.release()
    return []
  }
}

function request(image = tinyPng, body?: BodyInit): Request {
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
      authorization: 'Bearer free',
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
    GLOBAL_DAILY_LIMIT: '3000',
    IP_HASH_SECRET: '0123456789abcdef0123456789abcdef',
    MAX_IMAGE_BYTES: '4194304',
    MAX_IMAGE_PIXELS: '20000000',
    MAX_OUTPUT_TOKENS: '512',
    MAX_REQUEST_BYTES: '6291456',
    PUBLIC_API_KEY: 'free',
    GROQ_API_KEY_1: 'test-groq-key-1',
    GROQ_API_KEY_2: 'test-groq-key-2',
    GROQ_API_KEY_3: 'test-groq-key-3',
    USAGE_DB: database,
  } as Env
}

afterEach(() => vi.unstubAllGlobals())

describe('Worker request accounting', () => {
  it('calls Groq with an OpenAI vision message and returns its text', async () => {
    const database = new FakeD1()
    const groqFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: expect.stringMatching(/^Bearer test-groq-key-[123]$/) })
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
    const response = await worker.fetch(request(), environment(database))
    expect(response.status).toBe(200)
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      choices: [{ message: { content: 'A one-pixel test image.' } }],
      model: CANONICAL_MODEL,
      usage: { completion_tokens: 5, prompt_tokens: 12, total_tokens: 17 },
    })
    expect(groqFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(groqFetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      messages: [{
        content: [
          { text: 'User: Describe this image.', type: 'text' },
          { image_url: { url: tinyPng }, type: 'image_url' },
        ],
        role: 'user',
      }],
      max_tokens: 512,
      stream: false,
    })
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

  it('returns a sanitized upstream error when all Groq accounts are rate limited', async () => {
    const database = new FakeD1()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })))
    const response = await worker.fetch(request(), environment(database))
    expect(response.status).toBe(429)
    const payload = await response.json()
    expect(payload).toMatchObject({
      error: { code: 'upstream_rate_limit_exceeded' },
    })
    expect(JSON.stringify(payload)).not.toContain('test-groq-key')
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
