/** Durable configured-storage history used to authorize persisted image paths after Profile restarts. */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { resolveConfig, type VisionToolkitConfig } from './config.ts'

const storageHistoryStateSchema = z.object({
  roots: z.array(z.string().min(1)),
})

type StorageHistoryState = z.infer<typeof storageHistoryStateSchema>

/** Plugin-owned storage roots that survive Settings-provider and Profile restarts. */
export const storageHistoryDomainSpec = defineDomain({
  name: 'vision_toolkit_storage',
  version: 0,
  global: {
    schema: storageHistoryStateSchema,
    initial: { roots: [] },
  },
  tables: {},
})

interface StorageBinding {
  accepting: boolean
  global: DomainGlobal<StorageHistoryState>
}

function sameRoots(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((root, index) => root === right[index])
}

/**
 * Return every configured root that must remain readable, including the active root.
 * @param config - Settings generation to summarize.
 * @returns normalized configured roots in retention order.
 */
export function configuredStorageRoots(config: VisionToolkitConfig): string[] {
  const resolved = resolveConfig(config)
  return [...new Set([
    ...resolved.storageHistory,
    ...(resolved.storageDir === undefined ? [] : [resolved.storageDir]),
  ])]
}

/**
 * Merge plugin-owned roots into a Settings generation without retaining its active root as history.
 * @param config - Settings generation being restored.
 * @param durableRoots - roots loaded from the plugin-owned sidecar.
 * @returns the original generation when unchanged, otherwise a generation with restored history.
 */
export function restoreDurableStorageHistory(
  config: VisionToolkitConfig,
  durableRoots: readonly string[],
): VisionToolkitConfig {
  const resolved = resolveConfig(config)
  const storageHistory = [...new Set([...resolved.storageHistory, ...durableRoots])]
    .filter(root => root !== resolved.storageDir)
  if (sameRoots(storageHistory, resolved.storageHistory)) return config
  return { ...config, storageHistory }
}

/** Optional storage-domain sidecar for storage roots that Settings cannot persist itself. */
export class StorageHistoryStore {
  private storage: StorageBinding | undefined
  private storageFiber: (Fiber & PromiseLike<Fiber>) | undefined
  private storageReady: Promise<void> | undefined
  private mutationTail: Promise<void> = Promise.resolve()
  private desiredRoots: readonly string[] | undefined
  private persistenceTicket = 0
  private warned = false

  constructor(private readonly ctx: Context) {
    if (typeof ctx.inject !== 'function') return
    this.storageFiber = ctx.inject(['storageDomain'], async (storageCtx: Context) => {
      const domain = await storageCtx.storageDomain.open(storageHistoryDomainSpec)
      const binding: StorageBinding = { accepting: true, global: domain.global }
      this.storage = binding
      try {
        if (this.desiredRoots !== undefined) {
          await this.write(binding, this.desiredRoots, this.persistenceTicket)
        }
      } catch (error) {
        this.storage = undefined
        await domain.close()
        throw error
      }
      return async () => {
        binding.accepting = false
        if (this.storage === binding) this.storage = undefined
        await this.mutationTail
        await domain.close()
      }
    })
    this.storageReady = Promise.resolve(this.storageFiber).then(
      () => undefined,
      (error: unknown) => { this.warnOnce(error) },
    )
  }

  /**
   * Restore durable roots into one Settings generation before runtime preparation.
   * @param config - Settings generation to restore.
   * @returns the generation with available durable roots merged into its history.
   */
  async restore(config: VisionToolkitConfig): Promise<VisionToolkitConfig> {
    const binding = await this.prepareStorage()
    return restoreDurableStorageHistory(config, binding?.global.get().roots ?? [])
  }

  /**
   * Persist the active and historical configured roots.
   * @param config - validated generation whose roots must survive restart.
   * @returns false when no storage-domain is available; true after persistence or when there are no roots.
   */
  async persist(config: VisionToolkitConfig): Promise<boolean> {
    const roots = configuredStorageRoots(config)
    const ticket = ++this.persistenceTicket
    this.desiredRoots = roots
    if (roots.length === 0) return true
    const binding = await this.prepareStorage()
    if (binding === undefined) return false
    await this.write(binding, roots, ticket)
    return true
  }

  /** Release the optional storage-domain binding with the plugin lifecycle. */
  dispose(): void {
    const fiber = this.storageFiber
    this.storageFiber = undefined
    this.storageReady = undefined
    if (fiber !== undefined) void fiber.dispose().catch(error => { this.warnOnce(error) })
  }

  private async prepareStorage(): Promise<StorageBinding | undefined> {
    const current = this.activeStorage()
    if (current !== undefined) return current
    if (this.ctx.get('storageDomain') === undefined) return undefined
    await this.storageReady
    return this.activeStorage()
  }

  private activeStorage(): StorageBinding | undefined {
    return this.storage?.accepting === true ? this.storage : undefined
  }

  private write(binding: StorageBinding, roots: readonly string[], ticket: number): Promise<void> {
    return this.enqueueMutation(async () => {
      if (!binding.accepting) throw new Error('the storage-domain provider changed while storage history was pending')
      if (ticket !== this.persistenceTicket) return
      if (sameRoots(binding.global.get().roots, roots)) return
      await binding.global.set({ roots: [...roots] })
    })
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const result = this.mutationTail.then(operation)
    this.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private warnOnce(error: unknown): void {
    if (this.warned) return
    this.warned = true
    this.ctx.logger?.warn(
      'dsh-vision-toolkit: configured storage history sidecar is unavailable. %s',
      (error instanceof Error ? error.message : String(error)).slice(0, 500),
    )
  }
}
