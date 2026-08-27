import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedVisionToolkitConfig } from '../src/config.ts'
import type { VisionToolkitRuntime } from '../src/runtime.ts'
import { VisionToolkitRuntimeManager, type RuntimeGenerationFactory } from '../src/runtime-manager.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function fakeRuntime(config: ResolvedVisionToolkitConfig): VisionToolkitRuntime {
  return {
    upstreamVersion: {
      repository: 'https://github.com/Anionex/agent-vision-toolkit',
      version: 'fixture',
      commit: 'c27d1a300962b553c0884993c575cd3e819465ce',
      path: `/fixture/${config.provider.model}`,
      source: config.runtime.mode,
      runtimeHome: '/fixture/runtime',
      python: 'python3',
      pythonVersion: '3.12.0',
      dependencies: {},
    },
  } as unknown as VisionToolkitRuntime
}

function config(model: string) {
  return {
    provider: { baseUrl: 'https://vision.example/v1', credential: 'VISION_API_KEY', model },
    runtime: { mode: 'managed' as const },
  }
}

describe('VisionToolkitRuntimeManager', () => {
  it('prepares before publishing and retains the serving generation after failure', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const prepared: string[] = []
    const factory: RuntimeGenerationFactory = async (_ctx, resolved) => {
      prepared.push(resolved.provider.model)
      if (resolved.provider.model === 'broken') throw new Error('fixture runtime unavailable')
      return fakeRuntime(resolved)
    }
    const manager = new VisionToolkitRuntimeManager(ctx, factory)
    await manager.initialize(config('first'))
    const first = manager.current()

    await expect(manager.reconfigure(config('broken'))).rejects.toThrow('fixture runtime unavailable')
    expect(manager.current()).toBe(first)
    expect(manager.status()).toMatchObject({ ready: true, generation: 1, lastError: 'fixture runtime unavailable' })
    expect(prepared).toEqual(['first', 'broken'])
  })

  it('keeps consumers on the active configuration while a candidate fails', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const factory: RuntimeGenerationFactory = async (_ctx, resolved) => {
      if (resolved.storageDir === '/tmp/rejected-storage') throw new Error('fixture runtime unavailable')
      return fakeRuntime(resolved)
    }
    const manager = new VisionToolkitRuntimeManager(ctx, factory)
    await manager.initialize({ ...config('first'), storageDir: '/tmp/active-storage' })

    await expect(manager.reconfigure({ ...config('first'), storageDir: '/tmp/rejected-storage' }))
      .rejects.toThrow('fixture runtime unavailable')

    expect(manager.currentConfig().storageDir).toBe('/tmp/active-storage')
  })

  it('treats transparent-routing visibility as display-only so toggling it does not rebuild the runtime', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const factory = vi.fn(async (_ctx: Context, resolved: ResolvedVisionToolkitConfig) => fakeRuntime(resolved))
    const manager = new VisionToolkitRuntimeManager(ctx, factory)
    await manager.initialize(config('first'))
    expect(factory).toHaveBeenCalledTimes(1)

    const changed = await manager.reconfigure({ ...config('first'), imageInputVariants: { hidden: true } })

    expect(changed).toBe(false)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(manager.status()).toMatchObject({ ready: true, generation: 1 })
    expect(manager.status().activeConfig?.imageInputVariants.hidden).toBe(true)
  })

  it('prevents a slower obsolete Settings prepare from overwriting a newer one', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    let releaseSlow: (() => void) | undefined
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve })
    const factory: RuntimeGenerationFactory = async (_ctx, resolved) => {
      if (resolved.provider.model === 'slow') await slow
      return fakeRuntime(resolved)
    }
    const manager = new VisionToolkitRuntimeManager(ctx, factory)
    await manager.initialize(config('first'))

    const older = manager.reconfigure(config('slow'))
    await manager.reconfigure(config('newest'))
    releaseSlow?.()
    await older

    expect(manager.status().activeConfig?.provider.model).toBe('newest')
    expect(manager.current().upstreamVersion.path).toBe('/fixture/newest')
  })
})
