import {
  CANONICAL_MODEL,
  ProtocolError,
  boxOrderForModel,
  buildVisionInput,
  completionContent,
  completionFinishReason,
  parseChatCompletionRequest,
  tokenUsage,
  type VisionOutput,
} from './protocol'
import { materializeImage } from './image'
import { normalizeClientAddress } from './identity'
import { VisionProviderError, runVisionCompletion } from './groq'

const CORS_HEADERS = {
  'access-control-allow-headers': 'authorization, content-type, openai-organization, openai-project, x-stainless-arch, x-stainless-async, x-stainless-helper-method, x-stainless-lang, x-stainless-os, x-stainless-package-version, x-stainless-read-timeout, x-stainless-retry-count, x-stainless-runtime, x-stainless-runtime-version, x-stainless-timeout',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'retry-after, x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-request-id',
  'access-control-max-age': '86400',
} as const

interface QuotaReservation {
  clientHash: string
  day: string
  limit: number
  remaining: number
}

let lastUsageCleanupDay: string | undefined

export function preflightHeaders(request: Request): Headers {
  const headers = new Headers(CORS_HEADERS)
  const requestedHeaders = request.headers.get('access-control-request-headers')
  if (requestedHeaders) {
    const safeHeaders = requestedHeaders
      .split(',')
      .map(header => header.trim().toLowerCase())
      .filter(header => /^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(header))
    if (safeHeaders.length > 0) headers.set('access-control-allow-headers', safeHeaders.join(', '))
  }
  headers.set('cache-control', 'no-store')
  headers.set('vary', 'access-control-request-headers')
  return headers
}

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
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new ProtocolError('Service quota configuration is unavailable', {
      code: 'service_configuration_error',
      status: 503,
    })
  }
  const clientIp = normalizeClientAddress(request.headers.get('cf-connecting-ip') ?? 'unknown')
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

async function releaseCounters(env: Env, day: string, keys: string[], now: string): Promise<void> {
  const statements = keys.flatMap(key => [
    env.USAGE_DB.prepare(
      'DELETE FROM usage_daily WHERE day = ?1 AND client_hash = ?2 AND request_count = 1',
    ).bind(day, key),
    env.USAGE_DB.prepare(`
      UPDATE usage_daily
      SET request_count = request_count - 1, updated_at = ?3
      WHERE day = ?1 AND client_hash = ?2 AND request_count > 1
    `).bind(day, key, now),
  ])
  await env.USAGE_DB.batch(statements)
}

function scheduleUsageCleanup(env: Env, day: string, now: string, context?: ExecutionContext): void {
  if (lastUsageCleanupDay === day) return
  lastUsageCleanupDay = day

  const cutoff = new Date(Date.parse(now) - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const cleanup = env.USAGE_DB.prepare('DELETE FROM usage_daily WHERE day < ?1').bind(cutoff).run().catch(error => {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      event: 'quota_cleanup_failed',
    }))
  })
  context?.waitUntil(cleanup)
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

async function consumeDailyQuota(env: Env, hash: string, context?: ExecutionContext): Promise<QuotaReservation> {
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
    try {
      await releaseCounters(env, day, [hash], now)
    } catch (error) {
      console.error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        event: 'quota_rollback_failed',
      }))
    }
    throw new ProtocolError('The public free service has reached today\'s capacity', {
      code: 'global_daily_limit_exceeded',
      status: 429,
    })
  }
  if (globalCount === 1) scheduleUsageCleanup(env, day, now, context)
  return {
    clientHash: hash,
    day,
    limit: clientLimit,
    remaining: Math.max(0, clientLimit - clientCount),
  }
}

function authorizationError(env: Env): Response {
  return openAiError(`Use api_key="${env.PUBLIC_API_KEY}" for this public endpoint`, {
    code: 'invalid_api_key',
    headers: { 'www-authenticate': 'Bearer' },
    status: 401,
    type: 'authentication_error',
  })
}

function isAuthorized(request: Request, env: Env): boolean {
  const authorization = request.headers.get('authorization')
  return authorization === `Bearer ${env.PUBLIC_API_KEY}`
    || authorization === `Bearer ${env.LEGACY_PUBLIC_API_KEY}`
}

function modelList(): Response {
  return jsonResponse({
    data: [{
      created: 1_783_382_400,
      id: CANONICAL_MODEL,
      object: 'model',
      owned_by: 'groq',
    }],
    object: 'list',
  })
}

async function chatCompletion(request: Request, env: Env, context?: ExecutionContext): Promise<Response> {
  if (!isAuthorized(request, env)) return authorizationError(env)

  const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID()
  const startedAt = Date.now()
  let inferenceStarted = false
  let quota: QuotaReservation | undefined
  try {
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
    const body = await readBoundedJson(request, Number(env.MAX_REQUEST_BYTES))
    const completion = parseChatCompletionRequest(body, Number(env.MAX_IMAGE_BYTES))
    quota = await consumeDailyQuota(env, hash, context)
    const images = await Promise.all(completion.images.map(image => materializeImage(
      image,
      Number(env.MAX_IMAGE_BYTES),
      Number(env.MAX_IMAGE_PIXELS),
    )))
    const outputLimit = Number(env.MAX_OUTPUT_TOKENS)
    const maxTokens = Math.min(completion.maxTokens ?? outputLimit, outputLimit)
    const boxOrder = boxOrderForModel(completion.model)
    const modelInput = buildVisionInput(completion, images, maxTokens, boxOrder)

    inferenceStarted = true
    const output: VisionOutput = await runVisionCompletion(modelInput, env, requestId, boxOrder)
    const content = completionContent(output, completion.task, boxOrder)
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
        finish_reason: completionFinishReason(output),
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
    if (quota && !inferenceStarted) {
      try {
        await releaseCounters(env, quota.day, [quota.clientHash, '__global__'], new Date().toISOString())
      } catch (rollbackError) {
        console.error(JSON.stringify({
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          event: 'quota_rollback_failed',
          requestId,
        }))
      }
    }
    if (error instanceof VisionProviderError) {
      const headers = new Headers({ 'x-request-id': requestId })
      if (error.retryAfter) headers.set('retry-after', error.retryAfter)
      return openAiError(error.message, {
        code: error.code,
        headers,
        status: error.status,
        type: error.status === 429 ? 'rate_limit_error' : 'api_error',
      })
    }
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

async function fetchHandler(request: Request, env: Env, context?: ExecutionContext): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { headers: preflightHeaders(request), status: 204 })
  const url = new URL(request.url)

  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({ model: CANONICAL_MODEL, status: 'ok' })
  }
  if (request.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
    return isAuthorized(request, env) ? modelList() : authorizationError(env)
  }
  if (request.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
    return chatCompletion(request, env, context)
  }
  if (url.pathname === '/') {
    return jsonResponse({
      api_key: env.PUBLIC_API_KEY,
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
