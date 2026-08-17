import { ProtocolError, QWEN_MODEL, normalizeVisionOutput, type BoxOrder, type VisionInput, type VisionOutput } from './protocol'

export const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions'

const KEY_LEASE_MS = 120_000
const AUTH_COOLDOWN_MS = 15 * 60 * 1000
const RATE_LIMIT_COOLDOWN_MS = 60_000
const TRANSIENT_COOLDOWN_MS = 5_000

interface ProviderSecrets {
  GROQ_API_KEY_1?: string
  GROQ_API_KEY_2?: string
  GROQ_API_KEY_3?: string
  GROQ_API_KEY_4?: string
  GROQ_API_KEY_5?: string
  FALLBACK_VISION_API_KEY?: string
  FALLBACK_VISION_MODEL?: string
  FALLBACK_VISION_URL?: string
}

type ProviderEnv = Env & ProviderSecrets

export class VisionProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: string,
  ) {
    super(message)
    this.name = 'VisionProviderError'
  }
}

interface VisionUpstream {
  boxOrder: BoxOrder
  endpoint: string
  key: string
  model: string
  name: 'groq' | 'gemini'
  slot: number
}

function configuredUpstreams(env: ProviderEnv, boxOrder: BoxOrder = 'yxyx'): VisionUpstream[] {
  if (boxOrder === 'xyxy') {
    const candidates: Array<Omit<VisionUpstream, 'key'> & { key?: string }> = [
      { boxOrder, endpoint: GROQ_CHAT_COMPLETIONS_URL, key: env.GROQ_API_KEY_1, model: QWEN_MODEL, name: 'groq', slot: 0 },
      { boxOrder, endpoint: GROQ_CHAT_COMPLETIONS_URL, key: env.GROQ_API_KEY_2, model: QWEN_MODEL, name: 'groq', slot: 1 },
      { boxOrder, endpoint: GROQ_CHAT_COMPLETIONS_URL, key: env.GROQ_API_KEY_3, model: QWEN_MODEL, name: 'groq', slot: 2 },
      { boxOrder, endpoint: GROQ_CHAT_COMPLETIONS_URL, key: env.GROQ_API_KEY_4, model: QWEN_MODEL, name: 'groq', slot: 3 },
      { boxOrder, endpoint: GROQ_CHAT_COMPLETIONS_URL, key: env.GROQ_API_KEY_5, model: QWEN_MODEL, name: 'groq', slot: 4 },
    ]
    return candidates.flatMap((candidate) => {
      const key = candidate.key?.trim()
      return key ? [{ ...candidate, key }] : []
    })
  }
  const fallbackKey = env.FALLBACK_VISION_API_KEY?.trim()
  const fallbackEndpoint = env.FALLBACK_VISION_URL?.trim()
  const fallbackModel = env.FALLBACK_VISION_MODEL?.trim()
  if (fallbackKey && fallbackEndpoint && fallbackModel) {
    return [{
      boxOrder: 'yxyx' as const,
      endpoint: fallbackEndpoint,
      key: fallbackKey,
      model: fallbackModel,
      name: 'gemini' as const,
      slot: 5,
    }]
  }
  return []
}

interface KeyLease {
  slot: number
}

/** Cross-isolate key allocator backed by the Worker's existing D1 database. */
export class VisionUpstreamScheduler {
  constructor(private readonly database: D1Database) {}

  async acquire(slots: number[]): Promise<KeyLease | undefined> {
    if (slots.length === 0) return undefined
    const now = Date.now()
    await this.database.prepare(`
      UPDATE groq_key_state
      SET active_requests = 0, lease_expires_at = 0, updated_at = ?1
      WHERE active_requests > 0 AND lease_expires_at <= ?1
    `).bind(now).run()
    const slotParameters = slots.map((_, index) => `?${index + 3}`).join(', ')
    const lease = await this.database.prepare(`
      UPDATE groq_key_state
      SET
        active_requests = active_requests + 1,
        last_selected_at = ?1,
        lease_expires_at = MAX(lease_expires_at, ?2),
        updated_at = ?1
      WHERE key_slot = (
        SELECT key_slot
        FROM groq_key_state
        WHERE key_slot IN (${slotParameters}) AND cooldown_until <= ?1
        ORDER BY active_requests ASC, last_selected_at ASC, key_slot ASC
        LIMIT 1
      )
      RETURNING key_slot
    `).bind(now, now + KEY_LEASE_MS, ...slots).first<{ key_slot: number }>()
    return lease === null ? undefined : { slot: lease.key_slot }
  }

  async release(slot: number, cooldownMs = 0): Promise<void> {
    const now = Date.now()
    await this.database.prepare(`
      UPDATE groq_key_state
      SET
        active_requests = MAX(0, active_requests - 1),
        cooldown_until = MAX(cooldown_until, ?2),
        lease_expires_at = CASE WHEN active_requests <= 1 THEN 0 ELSE lease_expires_at END,
        updated_at = ?1
      WHERE key_slot = ?3
    `).bind(now, now + cooldownMs, slot).run()
  }

  async retryAfterSeconds(slots: number[]): Promise<string | undefined> {
    if (slots.length === 0) return undefined
    const now = Date.now()
    const slotParameters = slots.map((_, index) => `?${index + 1}`).join(', ')
    const next = await this.database.prepare(`
      SELECT MIN(cooldown_until) AS cooldown_until
      FROM groq_key_state
      WHERE key_slot IN (${slotParameters}) AND cooldown_until > ?${slots.length + 1}
    `).bind(...slots, now).first<{ cooldown_until: number | null }>()
    if (typeof next?.cooldown_until !== 'number') return undefined
    return String(Math.max(1, Math.ceil((next.cooldown_until - now) / 1000)))
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500
}

function allRequestsWereRateLimited(statuses: number[]): boolean {
  return statuses.includes(429) && statuses.every(status => status === 401 || status === 403 || status === 429)
}

function retryAfterMilliseconds(value: string | null): number {
  if (value === null) return RATE_LIMIT_COOLDOWN_MS
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, Math.ceil(seconds * 1000))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : RATE_LIMIT_COOLDOWN_MS
}

function cooldownForStatus(status: number, retryAfter: string | null): number {
  if (status === 401 || status === 403) return AUTH_COOLDOWN_MS
  if (status === 429) return retryAfterMilliseconds(retryAfter)
  if (status >= 500) return TRANSIENT_COOLDOWN_MS
  return 0
}

async function releaseLease(
  scheduler: VisionUpstreamScheduler,
  slot: number,
  requestId: string,
  cooldownMs = 0,
): Promise<void> {
  try {
    await scheduler.release(slot, cooldownMs)
  } catch (error) {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      event: 'vision_upstream_lease_release_failed',
      upstreamSlot: slot + 1,
      requestId,
    }))
  }
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

function invalidRequestError(status: number, message?: string): VisionProviderError {
  const detail = message ? `: ${message}` : ''
  if (status === 413) {
    return new VisionProviderError(
      `Vision provider rejected the request because it is too large${detail}`,
      413,
      'upstream_request_too_large',
    )
  }
  if (status === 404) {
    return new VisionProviderError('Vision model is temporarily unavailable', 502, 'upstream_model_unavailable')
  }
  return new VisionProviderError(
    `Vision provider rejected the request${detail}`,
    status === 422 ? 422 : 400,
    'upstream_invalid_request',
  )
}

export async function runVisionCompletion(
  input: VisionInput,
  env: ProviderEnv,
  requestId: string,
  boxOrder: BoxOrder,
): Promise<VisionOutput> {
  const upstreams = configuredUpstreams(env, boxOrder)
  if (upstreams.length === 0) {
    throw new ProtocolError('Vision providers are not configured', {
      code: 'service_configuration_error',
      status: 503,
    })
  }

  const scheduler = new VisionUpstreamScheduler(env.USAGE_DB)
  const upstreamBySlot = new Map(upstreams.map(upstream => [upstream.slot, upstream]))
  const slots = upstreams.map(upstream => upstream.slot)
  const secrets = upstreams.map(upstream => upstream.key)
  const statuses: number[] = []
  let lastRetryAfter: string | undefined
  let poolUnavailable = false

  for (let attempt = 0; attempt < upstreams.length; attempt += 1) {
    const lease = await scheduler.acquire(slots)
    if (lease === undefined) {
      poolUnavailable = true
      lastRetryAfter = await scheduler.retryAfterSeconds(slots) ?? lastRetryAfter
      break
    }
    const upstream = upstreamBySlot.get(lease.slot)
    if (upstream === undefined) {
      await releaseLease(scheduler, lease.slot, requestId, TRANSIENT_COOLDOWN_MS)
      continue
    }
    let response: Response
    try {
      response = await fetch(upstream.endpoint, {
        body: JSON.stringify({
          model: upstream.model,
          reasoning_effort: 'none',
          ...input,
        }),
        headers: {
          authorization: `Bearer ${upstream.key}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      })
    } catch {
      await releaseLease(scheduler, lease.slot, requestId, TRANSIENT_COOLDOWN_MS)
      if (attempt + 1 < upstreams.length) continue
      throw new VisionProviderError('Vision provider is temporarily unavailable', 502, 'upstream_error')
    }

    if (response.ok) {
      await releaseLease(scheduler, lease.slot, requestId)
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new VisionProviderError('Vision provider returned invalid JSON', 502, 'upstream_invalid_response')
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new VisionProviderError('Vision provider returned an invalid response', 502, 'upstream_invalid_response')
      }
      return normalizeVisionOutput(payload as Record<string, unknown>)
    }

    const upstreamMessage = await readUpstreamErrorMessage(response, secrets)
    statuses.push(response.status)
    const retryAfter = response.headers.get('retry-after')
    const cooldownMs = cooldownForStatus(response.status, retryAfter)
    lastRetryAfter = retryAfter
      ?? (response.status === 429 ? String(Math.ceil(cooldownMs / 1000)) : lastRetryAfter)
    await releaseLease(scheduler, lease.slot, requestId, cooldownMs)
    console.warn(JSON.stringify({
      attempt: attempt + 1,
      cooldownMs,
      event: 'vision_upstream_attempt_failed',
      provider: upstream.name,
      requestId,
      status: response.status,
      upstreamSlot: lease.slot + 1,
      ...(upstreamMessage === undefined ? {} : { upstreamMessage }),
    }))
    if (!isRetryableStatus(response.status)) throw invalidRequestError(response.status, upstreamMessage)
    if (attempt + 1 >= upstreams.length) break
  }

  if (allRequestsWereRateLimited(statuses) || poolUnavailable) {
    throw new VisionProviderError(
      'Vision provider rate limit reached; retry later',
      429,
      'rate_limit_exceeded',
      lastRetryAfter,
    )
  }
  if (statuses.length > 0 && statuses.every(status => status === 401 || status === 403)) {
    throw new VisionProviderError('Vision provider credentials are unavailable', 502, 'upstream_authentication_error')
  }
  throw new VisionProviderError('Vision provider is temporarily unavailable', 502, 'upstream_error')
}

export const __test__ = { configuredUpstreams, cooldownForStatus, retryAfterMilliseconds, sanitizeUpstreamMessage }
