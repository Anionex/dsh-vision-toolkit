/**
 * Transparent routing for the host model selector: when `imageInputVariants.hidden`
 * is enabled, variant routes keep the upstream provider/model display names and
 * the browser hides the upstream text-only entries that have a variant twin.
 * Users then see one entry per model — the original name — while the session
 * actually runs on the image-capable variant, so pasted images, history with
 * images, and the built-in `read_image` tool all keep working on text-only
 * models without exposing `(Vision Toolkit)` routes.
 *
 * The host selector renders one `[role=group]` per provider whose group title
 * id is `:<react-radix>:-<providerId>`, and one `[role=menuitemradio]` per
 * model. We key groups by that provider id (variant routes carry the
 * `vision-toolkit-` prefix) and hide every upstream entry whose display name
 * matches a variant twin, collapsing fully-hidden upstream groups.
 * @module dsh-vision-toolkit/model-variants-hider
 */

import { readDisplayConfig } from './display-config.ts'

const VARIANT_PROVIDER_PREFIX = 'vision-toolkit-'
const TIDY_DEBOUNCE_MS = 50

/** Elements we hid and their original inline display value, for restoration. */
const hiddenElements = new Map<HTMLElement, string>()

let active = false
let timer: ReturnType<typeof setTimeout> | undefined
let observer: MutationObserver | undefined

/** Derive the provider id from a group's `aria-labelledby` title id. */
function providerIdOf(group: Element): string | undefined {
  const labelledBy = group.getAttribute('aria-labelledby')
  if (labelledBy === null || labelledBy === '') return undefined
  const titleId = document.getElementById(labelledBy)?.id ?? labelledBy
  const reactPrefixed = /^:[^:]+:-(.+)$/u.exec(titleId)
  if (reactPrefixed !== null) return reactPrefixed[1]
  return titleId.replace(/^-/u, '')
}

function modelNames(group: Element): string[] {
  return [...group.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    .map(button => (button.title || (button.textContent ?? '')).trim())
    .filter(Boolean)
}

function hideElement(element: HTMLElement): void {
  if (!hiddenElements.has(element)) hiddenElements.set(element, element.style.display)
  element.style.display = 'none'
}

function restoreHidden(): void {
  for (const [element, display] of hiddenElements) {
    element.style.display = display
  }
  hiddenElements.clear()
}

/**
 * Hide upstream text-only entries that have a variant twin. Group keys come
 * from `aria-labelledby` ids so provider identity is reliable even when the
 * variant provider name equals the upstream name (transparent mode).
 */
export function tidyModelSelector(): void {
  // The host re-renders selectors while sessions stay open; drop bookkeeping
  // for entries that already left the DOM so the map cannot grow unboundedly.
  for (const element of [...hiddenElements.keys()]) {
    if (!element.isConnected) hiddenElements.delete(element)
  }
  const groups = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="group"]')]
  const byProvider = new Map<string, HTMLElement[]>()
  for (const group of groups) {
    const provider = providerIdOf(group)
    if (provider === undefined) continue
    const entries = byProvider.get(provider)
    if (entries === undefined) byProvider.set(provider, [group])
    else entries.push(group)
  }

  for (const [provider, providerGroups] of byProvider) {
    if (!provider.startsWith(VARIANT_PROVIDER_PREFIX)) continue
    const upstream = provider.slice(VARIANT_PROVIDER_PREFIX.length)
    const twinNames = new Set(providerGroups.flatMap(modelNames))
    if (twinNames.size === 0) continue
    for (const upstreamGroup of byProvider.get(upstream) ?? []) {
      const buttons = [...upstreamGroup.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      let visible = 0
      for (const button of buttons) {
        const name = (button.title || (button.textContent ?? '')).trim()
        if (twinNames.has(name)) hideElement(button)
        else if (button.style.display !== 'none') visible += 1
      }
      if (visible === 0) hideElement(upstreamGroup)
    }
  }
}

/**
 * Install the transparent-routing integrator. It watches the document for
 * model-selector renderings and re-tidies them whenever the host re-renders.
 * @returns the disposer that stops observation and restores hidden entries.
 */
export function installModelVariantsHider(): () => void {
  let disposed = false
  const tidySoon = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void (async () => {
        const { hidden } = await readDisplayConfig()
        if (disposed) return
        if (!hidden) {
          if (active) {
            restoreHidden()
            active = false
          }
          return
        }
        active = true
        tidyModelSelector()
      })()
    }, TIDY_DEBOUNCE_MS)
  }

  observer = new MutationObserver(tidySoon)
  observer.observe(document.body, { childList: true, subtree: true })
  tidySoon()

  return () => {
    disposed = true
    observer?.disconnect()
    observer = undefined
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    restoreHidden()
    active = false
  }
}

/** Test seam: expose whether the integrator currently considers routing active. */
export function isModelVariantsHiderActive(): boolean {
  return active
}
