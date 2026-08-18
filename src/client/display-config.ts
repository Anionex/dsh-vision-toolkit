/**
 * Browser-side display-mode flags for transparent variant routing. The model
 * selector integrator and the paste integration share one short-lived cache
 * so they do not hammer the same-origin route on every DOM mutation or paste.
 * @module dsh-vision-toolkit/display-config
 */

export const DISPLAY_CONFIG_ROUTE = '/_dsh/vision-toolkit/display-config'

const CONFIG_TTL_MS = 10_000

interface CachedDisplayConfig {
  hidden: boolean
  at: number
}

let cached: CachedDisplayConfig | undefined

/**
 * Resolve the current transparent-routing flag, failing closed to non-hidden
 * (explicit sibling entries) when the route is unreachable or the payload is
 * malformed.
 * @returns the display-mode flags observed from the host.
 */
export async function readDisplayConfig(): Promise<{ hidden: boolean }> {
  const now = Date.now()
  if (cached !== undefined && now - cached.at < CONFIG_TTL_MS) {
    return { hidden: cached.hidden }
  }
  try {
    const response = await fetch(DISPLAY_CONFIG_ROUTE, { cache: 'no-store' })
    if (!response.ok) throw new Error(`display-config ${response.status}`)
    const body = await response.json() as { ok?: boolean; value?: { hidden?: unknown } }
    if (body.ok !== true || typeof body.value?.hidden !== 'boolean') {
      throw new Error('malformed display-config payload')
    }
    cached = { hidden: body.value.hidden, at: now }
    return { hidden: body.value.hidden }
  } catch {
    // Transparent routing is an enhancement: an unreachable config must never
    // hide anything or change paste behavior.
    cached = { hidden: false, at: now }
    return { hidden: false }
  }
}

/** Drop the cached flag (test seams and connection-reset handling). */
export function resetDisplayConfigCache(): void {
  cached = undefined
}
