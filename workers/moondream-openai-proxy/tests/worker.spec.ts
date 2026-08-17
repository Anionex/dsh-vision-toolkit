import { afterEach, describe, expect, it, vi } from 'vitest'

import worker from '../src/index'
import {
  GROQ_CHAT_COMPLETIONS_URL,
  __test__ as providerTest,
} from '../src/groq'
import { CANONICAL_MODEL, QWEN_MODEL } from '../src/protocol'

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const publicApiKey = 'https://agent-vision.anionex.me'
const fallbackEndpoint = 'https://fallback.example/v1/chat/completions'
const fallbackModel = 'fallback-vision-model'

interface FakeKeyState {
  activeRequests: number
  cooldownUntil: number
  keySlot: number
  lastSelectedAt: number
  leaseExpiresAt: number
}

class FakeStatement {
  private values: unknown[] = []

  constructor(private readonly database: FakeD1, readonly sql: string) {}

  bind(...values: unknown[]): FakeStatement {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes('RETURNING key_slot')) {
      const now = Number(this.values[0])
      const leaseExpiresAt = Number(this.values[1])
      const slots = new Set(this.values.slice(2).map(Number))
      const selected = [...this.database.keyStates.values()]
        .filter(state => slots.has(state.keySlot) && state.cooldownUntil <= now)
        .sort((left, right) => left.activeRequests - right.activeRequests
          || left.lastSelectedAt - right.lastSelectedAt
          || left.keySlot - right.keySlot)[0]
      if (selected === undefined) return null
      selected.activeRequests += 1
      selected.lastSelectedAt = now
      selected.leaseExpiresAt = Math.max(selected.leaseExpiresAt, leaseExpiresAt)
      return { key_slot: selected.keySlot } as T
    }
    if (this.sql.includes('MIN(cooldown_until)')) {
      const now = Number(this.values.at(-1))
      const slots = new Set(this.values.slice(0, -1).map(Number))
      const next = [...this.database.keyStates.values()]
        .filter(state => slots.has(state.keySlot) && state.cooldownUntil > now)
        .reduce<number | null>((minimum, state) => minimum === null
          ? state.cooldownUntil
          : Math.min(minimum, state.cooldownUntil), null)
      return { cooldown_until: next } as T
    }
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
    if (this.sql.includes('SET active_requests = 0')) {
      const now = Number(this.values[0])
      for (const state of this.database.keyStates.values()) {
        if (state.activeRequests > 0 && state.leaseExpiresAt <= now) {
          state.activeRequests = 0
          state.leaseExpiresAt = 0
        }
      }
    }
    if (this.sql.includes('active_requests = MAX(0, active_requests - 1)')) {
      if (this.database.failSchedulerRelease) throw new Error('scheduler release unavailable')
      const cooldownUntil = Number(this.values[1])
      const slot = Number(this.values[2])
      const state = this.database.keyStates.get(slot)
      if (state !== undefined) {
        state.activeRequests = Math.max(0, state.activeRequests - 1)
        state.cooldownUntil = Math.max(state.cooldownUntil, cooldownUntil)
        if (state.activeRequests === 0) state.leaseExpiresAt = 0
      }
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
  failSchedulerRelease = false
  readonly keyStates = new Map<number, FakeKeyState>(Array.from({ length: 6 }, (_, keySlot) => [
    keySlot,
    { activeRequests: 0, cooldownUntil: 0, keySlot, lastSelectedAt: 0, leaseExpiresAt: 0 },
  ]))

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

function qwenRequest(body?: BodyInit): Request {
  const parsed = typeof body === 'string' ? JSON.parse(body) as Record<string, unknown> : {
    messages: [{
      content: [
        { text: 'Describe this image.', type: 'text' },
        { image_url: { url: tinyPng }, type: 'image_url' },
      ],
      role: 'user',
    }],
  }
  return request(tinyPng, JSON.stringify({ ...parsed, model: QWEN_MODEL }))
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
    FALLBACK_VISION_API_KEY: 'test-fallback-key',
    FALLBACK_VISION_MODEL: fallbackModel,
    FALLBACK_VISION_URL: fallbackEndpoint,
    USAGE_DB: database,
  } as Env
}

afterEach(() => vi.unstubAllGlobals())

describe('Worker request accounting', () => {
  it('trims configured provider secrets before using them as bearer tokens', () => {
    const env = environment(new FakeD1()) as Env & Record<string, string>
    env.GROQ_API_KEY_1 = '  test-groq-key-1\n'
    expect(providerTest.configuredUpstreams(env, 'xyxy')).toContainEqual(expect.objectContaining({
      key: 'test-groq-key-1',
      slot: 0,
    }))
  })

  it('keeps Gemini on a stable scheduler slot', () => {
    const upstream = providerTest.configuredUpstreams(environment(new FakeD1()))
      .find(candidate => candidate.name === 'gemini')
    expect(upstream).toMatchObject({
      endpoint: fallbackEndpoint,
      key: 'test-fallback-key',
      model: fallbackModel,
      name: 'gemini',
      slot: 5,
    })
  })

  it('selects the stable additional slot when primary secrets are absent', async () => {
    const database = new FakeD1()
    const waitUntil = vi.fn()
    const context = { waitUntil } as unknown as ExecutionContext
    const env = environment(database) as Env & Record<string, string | undefined>
    for (let index = 1; index <= 5; index += 1) delete env[`GROQ_API_KEY_${index}`]
    const providerFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(fallbackEndpoint)
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: 'Additional endpoint.', role: 'assistant' } }],
      })
    })
    vi.stubGlobal('fetch', providerFetch)

    const response = await worker.fetch(request(), env as Env, context)

    expect(response.status).toBe(200)
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(database.cleanupRuns).toBe(1)
    expect(database.keyStates.get(5)).toMatchObject({ activeRequests: 0 })
  })

  it('returns the sparse additional slot cooldown without contacting an upstream', async () => {
    const database = new FakeD1()
    database.keyStates.get(5)!.cooldownUntil = Date.now() + 5_000
    const env = environment(database) as Env & Record<string, string | undefined>
    for (let index = 1; index <= 5; index += 1) delete env[`GROQ_API_KEY_${index}`]
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)

    const response = await worker.fetch(request(), env as Env)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toMatch(/^[1-5]$/)
    expect(await response.json()).toMatchObject({ error: { code: 'rate_limit_exceeded' } })
    expect(providerFetch).not.toHaveBeenCalled()
  })

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

  it('calls Groq with an OpenAI vision message for Qwen-compatible requests', async () => {
    const database = new FakeD1()
    const groqFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: expect.stringMatching(/^Bearer test-groq-key-[1-5]$/) })
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.model).toBe(QWEN_MODEL)
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
    const response = await worker.fetch(qwenRequest(), environment(database))
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
      model: QWEN_MODEL,
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
    const response = await worker.fetch(qwenRequest(), environment(database))
    expect(response.status).toBe(200)
    expect(groqFetch).toHaveBeenCalledTimes(2)
    const firstAuth = String(groqFetch.mock.calls[0]?.[1]?.headers && new Headers(groqFetch.mock.calls[0]?.[1]?.headers).get('authorization'))
    const secondAuth = String(groqFetch.mock.calls[1]?.[1]?.headers && new Headers(groqFetch.mock.calls[1]?.[1]?.headers).get('authorization'))
    expect(firstAuth).not.toBe(secondAuth)
    expect(database.keyStates.get(0)).toMatchObject({ activeRequests: 0 })
    expect(database.keyStates.get(0)?.cooldownUntil).toBeGreaterThan(Date.now())
  })

  it('assigns simultaneous requests to the least-active Groq accounts', async () => {
    const database = new FakeD1()
    let releaseFetches: (() => void) | undefined
    const fetchGate = new Promise<void>(resolve => { releaseFetches = resolve })
    const groqFetch = vi.fn(async () => {
      await fetchGate
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: 'Balanced.', role: 'assistant' } }],
      })
    })
    vi.stubGlobal('fetch', groqFetch)

    const first = worker.fetch(qwenRequest(), environment(database))
    const second = worker.fetch(qwenRequest(), environment(database))
    await vi.waitFor(() => expect(groqFetch).toHaveBeenCalledTimes(2))

    const authorizations = groqFetch.mock.calls.map(call => new Headers(call[1]?.headers).get('authorization'))
    expect(new Set(authorizations).size).toBe(2)
    expect([...database.keyStates.values()].map(state => state.activeRequests)).toEqual([1, 1, 0, 0, 0, 0])

    releaseFetches?.()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect([...database.keyStates.values()].map(state => state.activeRequests)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('routes default Gemini requests to the Gemini endpoint', async () => {
    const database = new FakeD1()
    const providerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(fallbackEndpoint)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-fallback-key')
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: fallbackModel, reasoning_effort: 'none' })
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: 'Gemini answered.', role: 'assistant' } }],
      })
    })
    vi.stubGlobal('fetch', providerFetch)

    const response = await worker.fetch(request(), environment(database))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      choices: [{ message: { content: 'Gemini answered.' } }],
    })
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(String(providerFetch.mock.calls[0]?.[0])).toBe(fallbackEndpoint)
    expect([...database.keyStates.values()].map(state => state.activeRequests)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('keeps Qwen requests on Groq without touching Gemini', async () => {
    const database = new FakeD1()
    const providerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(GROQ_CHAT_COMPLETIONS_URL)
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: QWEN_MODEL, reasoning_effort: 'none' })
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: 'Qwen answered.', role: 'assistant' } }],
      })
    })
    vi.stubGlobal('fetch', providerFetch)

    const response = await worker.fetch(qwenRequest(), environment(database))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      choices: [{ message: { content: 'Qwen answered.' } }],
    })
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect([...database.keyStates.values()].map(state => state.activeRequests)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('keeps a successful inference response when lease cleanup fails', async () => {
    const database = new FakeD1()
    database.failSchedulerRelease = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      choices: [{ finish_reason: 'stop', message: { content: 'Still returned.', role: 'assistant' } }],
    })))

    const response = await worker.fetch(qwenRequest(), environment(database))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      choices: [{ message: { content: 'Still returned.' } }],
    })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('vision_upstream_lease_release_failed'))
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

  it('returns a non-retryable rate-limit code when every upstream is cooling down', async () => {
    const database = new FakeD1()
    const groqFetch = vi.fn(async () => new Response('rate limited', { status: 429 }))
    vi.stubGlobal('fetch', groqFetch)
    const response = await worker.fetch(qwenRequest(), environment(database))
    expect(response.status).toBe(429)
    const payload = await response.json()
    expect(payload).toMatchObject({
      error: { code: 'rate_limit_exceeded' },
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

    const response = await worker.fetch(qwenRequest(), environment(database))
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

    const response = await worker.fetch(qwenRequest(), environment(database))
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
