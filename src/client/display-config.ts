/**
 * Browser-side display-mode flags for transparent variant routing. The paste
 * integration uses a short-lived cache so it does not hammer the same-origin
 * route on every paste. The model selector itself decides purely from DOM
 * display names and does not read this route.
 * @module dsh-vision-toolkit/display-config
 */

export const DISPLAY_CONFIG_ROUTE = '/_dsh/vision-toolkit/display-config'

const CONFIG_TTL_MS = 10_000

interface CachedDisplayConfig {
  hidden: boolean
  at: number
}

let cached: CachedDisplayConfig | undefined
let cacheEpoch = 0

/**
 * Resolve the current transparent-routing flag, failing closed to non-hidden
 * (explicit sibling entries) when the route is unreachable or the payload is
 * malformed.
 * @returns the display-mode flags observed from the host.
 */
export async function readDisplayConfig(): Promise<{ hidden: boolean }> {
  for (;;) {
    const now = Date.now()
    if (cached !== undefined && now - cached.at < CONFIG_TTL_MS) {
      return { hidden: cached.hidden }
    }
    const epoch = cacheEpoch
    try {
      const response = await fetch(DISPLAY_CONFIG_ROUTE, { cache: 'no-store' })
      if (epoch !== cacheEpoch) continue
      const body = await response.json() as { ok?: boolean; value?: { hidden?: unknown } }
      if (epoch !== cacheEpoch) continue
      if (body.ok !== true || typeof body.value?.hidden !== 'boolean') {
        throw new Error('malformed display-config payload')
      }
      cached = { hidden: body.value.hidden, at: now }
      return { hidden: body.value.hidden }
    } catch {
      if (epoch !== cacheEpoch) continue
      // Transparent routing is an enhancement: an unreachable config must never
      // hide anything or change paste behavior.
      cached = { hidden: false, at: now }
      return { hidden: false }
    }
  }
}

/**
 * Drop the cached flag and invalidate in-flight responses (test seams,
 * Settings saves, and connection-reset handling). An older request that
 * resolves afterwards must not repopulate the cache with a stale flag.
 */
export function resetDisplayConfigCache(): void {
  cached = undefined
  cacheEpoch += 1
}
