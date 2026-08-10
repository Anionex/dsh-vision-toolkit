/**
 * @dsh-external/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Plugin lifecycle follows the documented readiness chain: verify the pinned
 * upstream checkout (runtime dependencies) → register the native tools →
 * mount the vision-tools skill. Any failure leaves no tools and no skill
 * behind, and disposal unregisters everything the plugin mounted.
 * @module @dsh-external/dsh-vision-toolkit
 */

import type { Context } from 'cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { ArtifactAccessController, prepareArtifactAccessKey } from './artifact-access.ts'
import {
  Config,
  VISION_TOOLKIT_SETTINGS_NAMESPACE,
  resolveConfig,
  type VisionToolkitConfig,
} from './config.ts'
import { VisionToolkitRuntimeManager } from './runtime-manager.ts'
import { VISION_TOOLS_SKILL } from './skill.ts'
import { createVisionTools } from './tools.ts'
import { PLUGIN_VERSION } from './version.ts'
import { installVisionToolkitWeb, VisionToolkitWebBackend } from './web.ts'

export const name = '@dsh-external/dsh-vision-toolkit'

export { Config }

export const inject = ['tools', 'credentials', 'skills', 'subprocess', 'settings']

/** Plugin entry: validate configuration synchronously, then mount asynchronously. */
export async function apply(ctx: Context, config: VisionToolkitConfig = {}): Promise<() => void> {
  // Registration itself rejects an invalid stored section before any runtime
  // or Tool becomes visible. The custom Web editor preflights runtime changes
  // before persistence; hand-edited settings still fail loud here or retain
  // the last serving generation when changed live.
  const settings = ctx.settings.register(VISION_TOOLKIT_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'live',
    validate: (value) => { resolveConfig(value) },
  })
  const manager = new VisionToolkitRuntimeManager(ctx)
  const artifacts = new ArtifactAccessController(await prepareArtifactAccessKey())
  const disposers: Array<() => void> = []
  let operationalDisposers: Array<() => void> | undefined

  const ensureOperational = (): void => {
    if (!manager.ready || operationalDisposers !== undefined) return
    const mounted: Array<() => void> = []
    try {
      for (const tool of createVisionTools(() => manager.current(), value => artifacts.presentationMeta(value))) {
        mounted.push(ctx.tools.register(tool))
      }
      mounted.push(ctx.skills.register(VISION_TOOLS_SKILL))
      operationalDisposers = mounted
      const info = manager.current().upstreamVersion
      ctx.logger.info(
        'dsh-vision-toolkit %s ready (upstream %s @ %s, checkout %s)',
        PLUGIN_VERSION,
        info.version,
        info.commit,
        info.path,
      )
    } catch (error) {
      for (const dispose of mounted.reverse()) dispose()
      throw error
    }
  }

  try {
    await manager.initialize(settings.get())
    ensureOperational()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.error(
      'dsh-vision-toolkit %s: runtime not ready; vision tools and the vision-tools skill are NOT registered. Settings remain available for repair. %s',
      PLUGIN_VERSION,
      message,
    )
  }

  const backend = new VisionToolkitWebBackend(ctx, manager, artifacts, ensureOperational)
  installVisionToolkitWeb(ctx, backend, artifacts)
  disposers.push(settings.watch(async (next) => {
    try {
      await manager.reconfigure(next)
      ensureOperational()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.error('dsh-vision-toolkit: keeping the previous runtime after a refused Settings generation. %s', message)
    }
  }))

  return () => {
    if (operationalDisposers !== undefined) {
      for (const dispose of operationalDisposers.reverse()) dispose()
      operationalDisposers = undefined
    }
    for (const dispose of disposers.reverse()) dispose()
  }
}
