import { describe, expect, it, vi } from 'vitest'
import {
  configuredStorageRoots,
  restoreDurableStorageHistory,
  StorageHistoryStore,
  storageHistoryDomainSpec,
} from '../src/storage-history.ts'

interface HarnessState {
  roots: string[]
}

function storageHarness(state: HarnessState, beforeFirstSet?: () => Promise<void>) {
  let firstSet = true
  const global = {
    get: vi.fn(() => ({ roots: [...state.roots] })),
    set: vi.fn(async (next: HarnessState) => {
      if (firstSet) {
        firstSet = false
        await beforeFirstSet?.()
      }
      state.roots = [...next.roots]
    }),
  }
  const close = vi.fn(async () => {})
  const storageDomain = {
    open: vi.fn(async (spec: unknown) => {
      expect(spec).toBe(storageHistoryDomainSpec)
      return { global, close }
    }),
  }
  const logger = { warn: vi.fn() }
  const ctx = {
    logger,
    get: (name: string) => name === 'storageDomain' ? storageDomain : undefined,
    inject: vi.fn((_deps: unknown, callback: (storageCtx: unknown) => unknown) => {
      let cleanup: (() => void | Promise<void>) | undefined
      const applied = Promise.resolve()
        .then(() => callback({ ...ctx, storageDomain }))
        .then((result) => { if (typeof result === 'function') cleanup = result as () => void | Promise<void> })
      return {
        then: (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
          applied.then(() => onFulfilled({}), onRejected),
        dispose: vi.fn(async () => {
          await applied
          await cleanup?.()
        }),
      }
    }),
  }
  return { close, ctx: ctx as never, global, logger, storageDomain }
}

describe('configured storage history', () => {
  it('restores a prior read-only storage root after a new store instance', async () => {
    const state: HarnessState = { roots: [] }
    const firstHarness = storageHarness(state)
    const first = new StorageHistoryStore(firstHarness.ctx)

    await expect(first.persist({ storageDir: '/storage/a' })).resolves.toBe(true)
    expect(state.roots).toEqual(['/storage/a'])
    first.dispose()

    const secondHarness = storageHarness(state)
    const second = new StorageHistoryStore(secondHarness.ctx)
    const restored = await second.restore({ storageDir: '/storage/b' })

    expect(restored).toEqual({ storageDir: '/storage/b', storageHistory: ['/storage/a'] })
    await expect(second.persist(restored)).resolves.toBe(true)
    expect(state.roots).toEqual(['/storage/a', '/storage/b'])
    second.dispose()
  })

  it('merges durable and configured roots without retaining the active root twice', () => {
    expect(restoreDurableStorageHistory(
      { storageDir: '/storage/b', storageHistory: ['/storage/c'] },
      ['/storage/a', '/storage/b'],
    )).toEqual({
      storageDir: '/storage/b',
      storageHistory: ['/storage/c', '/storage/a'],
    })
    expect(configuredStorageRoots({
      storageDir: '/storage/b',
      storageHistory: ['/storage/a', '/storage/b'],
    })).toEqual(['/storage/a', '/storage/b'])
  })

  it('keeps the newest persistence request when storage finishes opening concurrently', async () => {
    const state: HarnessState = { roots: [] }
    let announceFirstSet: (() => void) | undefined
    const firstSetStarted = new Promise<void>((resolve) => { announceFirstSet = resolve })
    let releaseFirstSet: (() => void) | undefined
    const firstSetGate = new Promise<void>((resolve) => { releaseFirstSet = resolve })
    const harness = storageHarness(state, async () => {
      announceFirstSet?.()
      await firstSetGate
    })
    const store = new StorageHistoryStore(harness.ctx)

    const first = store.persist({ storageDir: '/storage/a' })
    await firstSetStarted
    const second = store.persist({ storageDir: '/storage/b' })
    releaseFirstSet?.()

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(state.roots).toEqual(['/storage/b'])
    store.dispose()
  })

  it('leaves Settings usable when the optional storage-domain service is absent', async () => {
    const store = new StorageHistoryStore({
      get: () => undefined,
      logger: { warn: vi.fn() },
    } as never)

    await expect(store.restore({ storageDir: '/storage/a' }))
      .resolves.toEqual({ storageDir: '/storage/a' })
    await expect(store.persist({ storageDir: '/storage/a' })).resolves.toBe(false)
    store.dispose()
  })
})
