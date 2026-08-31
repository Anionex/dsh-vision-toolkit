import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedVisionToolkitConfig } from '../src/config.ts'
import type { VisionToolkitRuntime } from '../src/runtime.ts'
import { VisionToolkitRuntimeManager, type RuntimeGenerationFactory } from '../src/runtime-manager.ts'

const contexts: Context[] = []
const tempDirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-vision-toolkit-${prefix}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
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

  it('runs durable commit prerequisites after preparation and before publication', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const sequence: string[] = []
    const factory: RuntimeGenerationFactory = async (_ctx, resolved) => {
      sequence.push(`prepare:${resolved.provider.model}`)
      return fakeRuntime(resolved)
    }
    const manager = new VisionToolkitRuntimeManager(ctx, factory)
    await manager.initialize(config('first'))

    await expect(manager.reconfigure(config('second'), async (candidate) => {
      sequence.push(`persist:${candidate.config.provider.model}`)
      throw new Error('storage history unavailable')
    })).rejects.toThrow('storage history unavailable')

    expect(sequence).toEqual(['prepare:first', 'prepare:second', 'persist:second'])
    expect(manager.currentConfig().provider.model).toBe('first')
    expect(manager.status()).toMatchObject({
      ready: true,
      generation: 1,
      lastError: 'storage history unavailable',
    })
  })

  it.skipIf(typeof process.geteuid !== 'function')('keeps consumers on the active configuration while a candidate fails', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const activeStorage = await tempDir('active-storage')
    const rejectedStorage = await tempDir('rejected-storage')
    const factory: RuntimeGenerationFactory = async (_ctx, resolved) => {
      if (resolved.storageDir === rejectedStorage) throw new Error('fixture runtime unavailable')
      return fakeRuntime(resolved)
    }
    const manager = new VisionToolkitRuntimeManager(ctx, factory)
    await manager.initialize({ ...config('first'), storageDir: activeStorage })

    await expect(manager.reconfigure({ ...config('first'), storageDir: rejectedStorage }))
      .rejects.toThrow('fixture runtime unavailable')

    expect(manager.currentConfig().storageDir).toBe(activeStorage)
  })

  it('rejects an unusable shared storage root before preparing or replacing the runtime', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const factory = vi.fn(async (_ctx: Context, resolved: ResolvedVisionToolkitConfig) => fakeRuntime(resolved))
    const manager = new VisionToolkitRuntimeManager(ctx, factory)
    await manager.initialize(config('first'))
    const first = manager.current()
    const parent = await tempDir('invalid-storage')
    const file = join(parent, 'not-a-directory')
    await writeFile(file, 'fixture')

    await expect(manager.reconfigure({ ...config('second'), storageDir: file }))
      .rejects.toThrow(/configured storage directory/u)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(manager.current()).toBe(first)
    expect(manager.status()).toMatchObject({ ready: true, generation: 1 })
  })

  it.skipIf(typeof process.geteuid !== 'function')('keeps validated startup storage available when initial runtime preparation fails', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const shared = await tempDir('startup-storage')
    const manager = new VisionToolkitRuntimeManager(ctx, async () => {
      throw new Error('fixture runtime unavailable')
    })

    await expect(manager.initialize({ ...config('broken'), storageDir: shared }))
      .rejects.toThrow('fixture runtime unavailable')

    expect(manager.ready).toBe(false)
    expect(manager.storageGeneration()).toEqual({ generation: 0, storageDir: shared })
    expect(manager.validatedStorageDirectory()).toBe(shared)
  })

  it('keeps best-effort consumers usable when startup storage preflight fails', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const parent = await tempDir('invalid-startup-storage')
    const file = join(parent, 'not-a-directory')
    await writeFile(file, 'fixture')
    const factory = vi.fn(async (_ctx: Context, resolved: ResolvedVisionToolkitConfig) => fakeRuntime(resolved))
    const manager = new VisionToolkitRuntimeManager(ctx, factory)

    await expect(manager.initialize({ ...config('broken'), storageDir: file }))
      .rejects.toThrow(/configured storage directory/u)

    expect(manager.ready).toBe(false)
    expect(manager.validatedStorageDirectory()).toBeUndefined()
    expect(() => manager.storageGeneration()).toThrow('storage configuration is not ready')
    expect(factory).not.toHaveBeenCalled()
  })

  it.skipIf(typeof process.geteuid !== 'function')('passes previously validated storage roots to later runtime generations', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const firstStorage = await tempDir('history-first')
    const secondStorage = await tempDir('history-second')
    const seen: string[][] = []
    const factory: RuntimeGenerationFactory = async (_ctx, resolved, readableStorageDirs) => {
      seen.push([...readableStorageDirs])
      return fakeRuntime(resolved)
    }
    const manager = new VisionToolkitRuntimeManager(ctx, factory)

    await manager.initialize({ ...config('first'), storageDir: firstStorage })
    await manager.reconfigure({ ...config('second'), storageDir: secondStorage })

    expect(seen).toEqual([[], [firstStorage]])
  })

  it.skipIf(typeof process.geteuid !== 'function')('retains startup storage after initial runtime preparation fails', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const firstStorage = await tempDir('failed-history-first')
    const secondStorage = await tempDir('failed-history-second')
    const seen: string[][] = []
    const factory: RuntimeGenerationFactory = async (_ctx, resolved, readableStorageDirs) => {
      seen.push([...readableStorageDirs])
      if (resolved.provider.model === 'broken') throw new Error('fixture runtime unavailable')
      return fakeRuntime(resolved)
    }
    const manager = new VisionToolkitRuntimeManager(ctx, factory)

    await expect(manager.initialize({ ...config('broken'), storageDir: firstStorage }))
      .rejects.toThrow('fixture runtime unavailable')
    await manager.reconfigure({ ...config('repaired'), storageDir: secondStorage })

    expect(seen).toEqual([[], [firstStorage]])
  })

  it.skipIf(typeof process.geteuid !== 'function')('restores readable storage history from persisted configuration', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const previousStorage = await tempDir('persisted-history-previous')
    const currentStorage = await tempDir('persisted-history-current')
    const seen: string[][] = []
    const factory: RuntimeGenerationFactory = async (_ctx, resolved, readableStorageDirs) => {
      seen.push([...readableStorageDirs])
      return fakeRuntime(resolved)
    }
    const manager = new VisionToolkitRuntimeManager(ctx, factory)

    await manager.initialize({
      ...config('current'),
      storageDir: currentStorage,
      storageHistory: [previousStorage],
    })

    expect(seen).toEqual([[previousStorage]])
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
