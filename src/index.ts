/**
 * @anionex/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Plugin lifecycle follows the documented readiness chain: verify the pinned
 * upstream checkout, publish the vision-tools Skill and its one-shot bootstrap,
 * then mount the execution tools only in Agents that load that Skill. Any
 * failure leaves no model capability behind, and disposal unregisters every
 * global and Agent-scoped contribution the plugin mounted.
 * @module @anionex/dsh-vision-toolkit
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import { ArtifactAccessController, prepareArtifactAccessKey } from './artifact-access.ts'
import {
  Config,
  VISION_TOOLKIT_SETTINGS_NAMESPACE,
  resolveConfig,
  type VisionToolkitConfig,
} from './config.ts'
import { VisionToolExposure } from './exposure.ts'
import { createPasteTakeoverResolver, installImageInputVariants } from './image-input-variants.ts'
import { VisionToolkitRuntimeManager } from './runtime-manager.ts'
import { VISION_TOOLS_SKILL } from './skill.ts'
import { createVisionTools } from './tools.ts'
import { PLUGIN_VERSION } from './version.ts'
import { installVisionToolkitWeb, VisionToolkitWebBackend } from './web.ts'
import { PastedImageBackend } from './paste-images.ts'

export const name = '@anionex/dsh-vision-toolkit'

export { Config }

export const inject = ['tools', 'credentials', 'skills', 'subprocess', 'settings', 'agents', 'sessions']

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
  const lifecycle = new AbortController()
  const disposers: Array<() => void> = []
  let operationalDisposers: { activationTool: () => void; exposure: () => void; skill: () => void } | undefined

  const ensureOperational = (): void => {
    if (!manager.ready || operationalDisposers !== undefined) return
    const exposure = new VisionToolExposure(ctx, () => createVisionTools(
      () => manager.current(),
      value => artifacts.presentationMeta(value),
      lifecycle.signal,
    ))
    let activationTool: (() => void) | undefined
    let exposureDisposer: (() => void) | undefined
    let skill: (() => void) | undefined
    try {
      activationTool = ctx.tools.register(exposure.activationTool)
      skill = ctx.skills.register(VISION_TOOLS_SKILL)
      exposureDisposer = exposure.install()
      operationalDisposers = { activationTool, exposure: exposureDisposer, skill }
      const info = manager.current().upstreamVersion
      ctx.logger.info(
        'dsh-vision-toolkit %s ready (upstream %s @ %s, checkout %s)',
        PLUGIN_VERSION,
        info.version,
        info.commit,
        info.path,
      )
    } catch (error) {
      exposureDisposer?.()
      if (skill !== undefined) skill()
      activationTool?.()
      throw error
    }
  }

  try {
    await manager.initialize(settings.get())
    ensureOperational()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.error(
      'dsh-vision-toolkit %s: runtime not ready; the vision-tools skill, activation bootstrap, and Agent-scoped visual tools are NOT registered. Settings remain available for repair. %s',
      PLUGIN_VERSION,
      message,
    )
  }

  const backend = new VisionToolkitWebBackend(ctx, manager, artifacts, ensureOperational)
  const pastedImages = new PastedImageBackend(ctx, {
    maxImageBytes: () => manager.status().activeConfig?.maxImageBytes ?? resolveConfig(settings.get()).maxImageBytes,
  })
  // Image-input variants register asynchronously once eligible routes exist;
  // the runtime getter stays lazy so variants appear even when the runtime
  // becomes ready after the first sweep.
  const variants = installImageInputVariants(
    ctx,
    () => resolveConfig(settings.get()),
    () => manager.ready ? manager.current() : undefined,
  )
  installVisionToolkitWeb(
    ctx,
    backend,
    artifacts,
    pastedImages,
    createPasteTakeoverResolver(ctx),
  )
  disposers.push(variants.dispose)
  disposers.push(settings.watch(async (next) => {
    try {
      await manager.reconfigure(next)
      ensureOperational()
      variants.reconcile()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.error('dsh-vision-toolkit: keeping the previous runtime after a refused Settings generation. %s', message)
    }
  }))

  return () => {
    lifecycle.abort()
    if (operationalDisposers !== undefined) {
      operationalDisposers.exposure()
      operationalDisposers.activationTool()
      operationalDisposers.skill()
      operationalDisposers = undefined
    }
    for (const dispose of disposers.reverse()) dispose()
  }
}
