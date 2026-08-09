/**
 * @dsh-external/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Plugin lifecycle follows the documented readiness chain: verify the pinned
 * upstream checkout (runtime dependencies) → register the six native tools →
 * mount the vision-tools skill. Any failure leaves no tools and no skill
 * behind, and disposal unregisters everything the plugin mounted.
 * @module @dsh-external/dsh-vision-toolkit
 */

import type { Context } from 'cordis'
import { resolveConfig, type VisionToolkitConfig } from './config.ts'
import { VisionToolkitRuntime } from './runtime.ts'
import { UpstreamAdapter } from './upstream.ts'
import { VISION_TOOLS_SKILL } from './skill.ts'
import { createVisionTools } from './tools.ts'
import { PLUGIN_VERSION } from './version.ts'

export const name = '@dsh-external/dsh-vision-toolkit'

export const inject = ['tools', 'credentials', 'skills', 'subprocess']

/** Plugin entry: validate configuration synchronously, then mount asynchronously. */
export async function apply(ctx: Context, config: VisionToolkitConfig = {}): Promise<() => void> {
  const resolved = resolveConfig(config)
  const adapter = new UpstreamAdapter(ctx, resolved)
  const runtime = new VisionToolkitRuntime(ctx, resolved, adapter)

  try {
    await adapter.prepare()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.error(
      'dsh-vision-toolkit %s: runtime not ready; vision tools and the vision-tools skill are NOT registered. %s',
      PLUGIN_VERSION,
      message,
    )
    return () => {}
  }
  const disposers: Array<() => void> = []
  for (const tool of createVisionTools(runtime)) {
    disposers.push(ctx.tools.register(tool))
  }
  disposers.push(ctx.skills.register(VISION_TOOLS_SKILL))
  ctx.logger.info(
    'dsh-vision-toolkit %s ready (upstream %s @ %s, checkout %s)',
    PLUGIN_VERSION,
    adapter.versionInfo.version,
    adapter.versionInfo.commit,
    adapter.versionInfo.path,
  )
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
