import {
  CANONICAL_MODEL,
  ProtocolError,
  completionContent,
  normalizeMoondreamOutput,
  parseChatCompletionRequest,
  tokenUsage,
  type MoondreamOutput,
} from './protocol'

const CORS_HEADERS = {
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'retry-after, x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-request-id',
  'access-control-max-age': '86400',
} as const

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers)
  headers.set('cache-control', 'no-store')
  headers.set('content-type', 'application/json; charset=utf-8')
  for (const [name, headerValue] of Object.entries(CORS_HEADERS)) headers.set(name, headerValue)
  return Response.json(value, { ...init, headers })
}

function openAiError(
  message: string,
  options?: { code?: string; headers?: HeadersInit; param?: string | null; status?: number; type?: string },
): Response {
  return jsonResponse({
    error: {
      code: options?.code ?? 'invalid_request',
      message,
      param: options?.param ?? null,
      type: options?.type ?? 'invalid_request_error',
    },
  }, {
    headers: options?.headers,
    status: options?.status ?? 400,
  })
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new ProtocolError(`Request body exceeds ${maxBytes} bytes`, {
      code: 'request_too_large',
      status: 413,
    })
  }
  if (!request.body) throw new ProtocolError('Request body is required')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel('request body too large')
      throw new ProtocolError(`Request body exceeds ${maxBytes} bytes`, {
        code: 'request_too_large',
        status: 413,
      })
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
  } catch {
    throw new ProtocolError('Request body must be valid UTF-8 JSON', { code: 'invalid_json' })
  }
}

async function clientHash(request: Request, secret: string): Promise<string> {
  const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(clientIp))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function consumeCounter(
  env: Env,
  day: string,
  key: string,
  limit: number,
  now: string,
): Promise<number | null> {
  const row = await env.USAGE_DB.prepare(`
    INSERT INTO usage_daily (day, client_hash, request_count, updated_at)
    VALUES (?1, ?2, 1, ?3)
    ON CONFLICT(day, client_hash) DO UPDATE SET
      request_count = usage_daily.request_count + 1,
      updated_at = excluded.updated_at
    WHERE usage_daily.request_count < ?4
    RETURNING request_count
  `).bind(day, key, now, limit).first<{ request_count: number }>()
  return row?.request_count ?? null
}

async function consumeDailyQuota(env: Env, hash: string): Promise<{ limit: number; remaining: number }> {
  const clientLimit = Number(env.DAILY_LIMIT)
  const globalLimit = Number(env.GLOBAL_DAILY_LIMIT)
  const now = new Date().toISOString()
  const day = now.slice(0, 10)
  const clientCount = await consumeCounter(env, day, hash, clientLimit, now)
  if (clientCount === null) {
    throw new ProtocolError(`Daily free limit of ${clientLimit} requests reached`, {
      code: 'daily_rate_limit_exceeded',
      status: 429,
    })
  }
  const globalCount = await consumeCounter(env, day, '__global__', globalLimit, now)
  if (globalCount === null) {
    throw new ProtocolError('The public free service has reached today\'s capacity', {
      code: 'global_daily_limit_exceeded',
      status: 429,
    })
  }
  if (globalCount === 1) {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await env.USAGE_DB.prepare('DELETE FROM usage_daily WHERE day < ?1').bind(cutoff).run()
  }
  return { limit: clientLimit, remaining: Math.max(0, clientLimit - clientCount) }
}

function authorizationError(): Response {
  return openAiError('Use api_key="free" for this public endpoint', {
    code: 'invalid_api_key',
    headers: { 'www-authenticate': 'Bearer' },
    status: 401,
    type: 'authentication_error',
  })
}

function isAuthorized(request: Request, env: Env): boolean {
  return request.headers.get('authorization') === `Bearer ${env.PUBLIC_API_KEY}`
}

function modelList(): Response {
  return jsonResponse({
    data: [{
      created: 1_783_382_400,
      id: CANONICAL_MODEL,
      object: 'model',
      owned_by: 'cloudflare',
    }],
    object: 'list',
  })
}

async function chatCompletion(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return authorizationError()

  const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID()
  const startedAt = Date.now()
  try {
    const body = await readBoundedJson(request, Number(env.MAX_REQUEST_BYTES))
    const completion = parseChatCompletionRequest(body, Number(env.MAX_IMAGE_BYTES))
    const hash = await clientHash(request, env.IP_HASH_SECRET)
    const burst = await env.BURST_LIMITER.limit({ key: hash })
    if (!burst.success) {
      return openAiError('Too many requests; retry in one minute', {
        code: 'rate_limit_exceeded',
        headers: { 'retry-after': '60', 'x-request-id': requestId },
        status: 429,
        type: 'rate_limit_error',
      })
    }
    const quota = await consumeDailyQuota(env, hash)
    const maxTokens = Math.min(completion.maxTokens ?? 512, Number(env.MAX_OUTPUT_TOKENS))
    const modelInput: Record<string, unknown> = {
      image: completion.image,
      max_tokens: maxTokens,
      reasoning: false,
      stream: false,
      task: completion.task,
    }
    if (completion.temperature !== undefined) modelInput.temperature = completion.temperature
    if (completion.topP !== undefined) modelInput.top_p = completion.topP
    if (completion.task === 'query') modelInput.question = completion.question
    if (completion.task === 'caption') modelInput.caption_length = completion.captionLength
    if (completion.task === 'point' || completion.task === 'detect') modelInput.target = completion.target

    const rawOutput = await env.AI.run(CANONICAL_MODEL, modelInput, {
      tags: ['dsh-vision-free', completion.task],
    })
    const output: MoondreamOutput = normalizeMoondreamOutput(rawOutput)
    const content = completionContent(output, completion.task)
    const usage = tokenUsage(output)
    const headers = new Headers({
      'x-ratelimit-limit-requests': String(quota.limit),
      'x-ratelimit-remaining-requests': String(quota.remaining),
      'x-request-id': requestId,
    })

    console.log(JSON.stringify({
      completionTokens: usage.completion_tokens,
      event: 'request_complete',
      latencyMs: Date.now() - startedAt,
      promptTokens: usage.prompt_tokens,
      requestId,
      task: completion.task,
    }))

    return jsonResponse({
      choices: [{
        finish_reason: typeof output.finish_reason === 'string' ? output.finish_reason : 'stop',
        index: 0,
        logprobs: null,
        message: {
          content,
          refusal: null,
          role: 'assistant',
        },
      }],
      created: Math.floor(Date.now() / 1000),
      id: `chatcmpl-${crypto.randomUUID().replaceAll('-', '')}`,
      model: CANONICAL_MODEL,
      object: 'chat.completion',
      usage,
    }, { headers })
  } catch (error) {
    if (error instanceof ProtocolError) {
      const headers = new Headers({ 'x-request-id': requestId })
      if (error.code === 'daily_rate_limit_exceeded' || error.code === 'global_daily_limit_exceeded') {
        const tomorrow = new Date()
        tomorrow.setUTCHours(24, 0, 0, 0)
        headers.set('retry-after', String(Math.max(1, Math.ceil((tomorrow.getTime() - Date.now()) / 1000))))
        headers.set('x-ratelimit-remaining-requests', '0')
      }
      return openAiError(error.message, {
        code: error.code,
        headers,
        param: error.param,
        status: error.status,
        type: error.status === 429
          ? 'rate_limit_error'
          : error.status >= 500 ? 'api_error' : 'invalid_request_error',
      })
    }
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      event: 'request_failed',
      latencyMs: Date.now() - startedAt,
      requestId,
    }))
    return openAiError('Vision inference is temporarily unavailable', {
      code: 'upstream_error',
      status: 502,
      type: 'api_error',
    })
  }
}

async function fetchHandler(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS, status: 204 })
  const url = new URL(request.url)

  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({ model: CANONICAL_MODEL, status: 'ok' })
  }
  if (request.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
    return isAuthorized(request, env) ? modelList() : authorizationError()
  }
  if (request.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
    return chatCompletion(request, env)
  }
  if (url.pathname === '/') {
    return jsonResponse({
      api_key: 'free',
      base_url: `${url.origin}/v1`,
      model: CANONICAL_MODEL,
      status: 'ok',
    })
  }
  return openAiError('Route not found', { code: 'not_found', status: 404 })
}

export default {
  fetch: fetchHandler,
} satisfies ExportedHandler<Env>
