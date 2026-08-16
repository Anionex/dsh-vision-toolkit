import { CANONICAL_MODEL, ProtocolError, normalizeVisionOutput, type VisionInput, type VisionOutput } from './protocol'

export const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'

interface GroqSecrets {
  GROQ_API_KEY_1?: string
  GROQ_API_KEY_2?: string
  GROQ_API_KEY_3?: string
}

type GroqEnv = Env & GroqSecrets

export class GroqProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: string,
  ) {
    super(message)
    this.name = 'GroqProviderError'
  }
}

function configuredKeys(env: GroqEnv): string[] {
  return [env.GROQ_API_KEY_1, env.GROQ_API_KEY_2, env.GROQ_API_KEY_3]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function selectKeyIndex(requestId: string, count: number): number {
  let hash = 0
  for (const character of requestId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % count
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500
}

function allRequestsWereRateLimited(statuses: number[]): boolean {
  return statuses.length > 0 && statuses.every(status => status === 429)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeUpstreamMessage(value: string, keys: string[]): string | undefined {
  let message = value.replace(/\s+/g, ' ').trim()
  if (message.length === 0) return undefined

  for (const key of keys) message = message.replaceAll(key, '[REDACTED]')
  message = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [REDACTED]')
    .replace(/\bgsk_[A-Za-z0-9_-]+\b/g, '[REDACTED]')

  return message.slice(0, 500)
}

async function readUpstreamErrorMessage(response: Response, keys: string[]): Promise<string | undefined> {
  try {
    const text = await response.text()
    if (text.length === 0 || text.length > 8_192) return undefined
    const payload: unknown = JSON.parse(text)
    if (!isRecord(payload)) return undefined

    const error = payload.error
    const message = isRecord(error) ? error.message : payload.message
    return typeof message === 'string' ? sanitizeUpstreamMessage(message, keys) : undefined
  } catch {
    return undefined
  }
}

function invalidRequestError(status: number, message?: string): GroqProviderError {
  const detail = message ? `: ${message}` : ''
  if (status === 413) {
    return new GroqProviderError(
      `Vision provider rejected the request because it is too large${detail}`,
      413,
      'upstream_request_too_large',
    )
  }
  if (status === 404) {
    return new GroqProviderError('Vision model is temporarily unavailable', 502, 'upstream_model_unavailable')
  }
  return new GroqProviderError(
    `Vision provider rejected the request${detail}`,
    status === 422 ? 422 : 400,
    'upstream_invalid_request',
  )
}

export async function runGroqCompletion(
  input: VisionInput,
  env: GroqEnv,
  requestId: string,
): Promise<VisionOutput> {
  const keys = configuredKeys(env)
  if (keys.length === 0) {
    throw new ProtocolError('Groq vision provider is not configured', {
      code: 'service_configuration_error',
      status: 503,
    })
  }

  const start = selectKeyIndex(requestId, keys.length)
  const statuses: number[] = []
  let lastRetryAfter: string | undefined

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const key = keys[(start + attempt) % keys.length]!
    let response: Response
    try {
      response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        body: JSON.stringify({
          model: CANONICAL_MODEL,
          reasoning_effort: 'none',
          ...input,
        }),
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      })
    } catch {
      if (attempt + 1 < keys.length) continue
      throw new GroqProviderError('Vision provider is temporarily unavailable', 502, 'upstream_error')
    }

    if (response.ok) {
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new GroqProviderError('Vision provider returned invalid JSON', 502, 'upstream_invalid_response')
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new GroqProviderError('Vision provider returned an invalid response', 502, 'upstream_invalid_response')
      }
      return normalizeVisionOutput(payload as Record<string, unknown>)
    }

    const upstreamMessage = await readUpstreamErrorMessage(response, keys)
    statuses.push(response.status)
    lastRetryAfter = response.headers.get('retry-after') ?? lastRetryAfter
    if (!isRetryableStatus(response.status)) throw invalidRequestError(response.status, upstreamMessage)
    if (attempt + 1 >= keys.length) break
  }

  if (allRequestsWereRateLimited(statuses)) {
    throw new GroqProviderError(
      'Vision provider rate limit reached; retry later',
      429,
      'upstream_rate_limit_exceeded',
      lastRetryAfter,
    )
  }
  if (statuses.length > 0 && statuses.every(status => status === 401 || status === 403)) {
    throw new GroqProviderError('Vision provider credentials are unavailable', 502, 'upstream_authentication_error')
  }
  throw new GroqProviderError('Vision provider is temporarily unavailable', 502, 'upstream_error')
}

export const __test__ = { configuredKeys, sanitizeUpstreamMessage, selectKeyIndex }
