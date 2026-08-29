/**
 * Atomic live configuration owner for the plugin's internal runtime. A new
 * upstream adapter is fully prepared before it replaces the currently serving
 * runtime, so failed Settings edits never interrupt in-flight or later calls.
 * @module dsh-vision-toolkit/runtime-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig, type ResolvedVisionToolkitConfig, type VisionToolkitConfig } from './config.ts'
import { preflightSharedStorageBase } from './paths.ts'
import { VisionToolkitRuntime } from './runtime.ts'
import { UpstreamAdapter, type UpstreamVersionInfo } from './upstream.ts'

/** One completely prepared configuration generation. */
export interface PreparedRuntimeGeneration {
  config: ResolvedVisionToolkitConfig
  fingerprint: string
  runtime: VisionToolkitRuntime
}

/** Public, secret-free status used by the Settings page. */
export interface RuntimeManagerStatus {
  ready: boolean
  generation: number
  activeConfig?: ResolvedVisionToolkitConfig
  upstream?: UpstreamVersionInfo
  lastError?: string
}

/** Storage selection paired to the active or validated startup generation. */
export interface RuntimeStorageGeneration {
  generation: number
  storageDir?: string
}

/** Test seam for preparing one generation. */
export type RuntimeGenerationFactory = (
  ctx: Context,
  config: ResolvedVisionToolkitConfig,
  readableStorageDirs: readonly string[],
) => Promise<VisionToolkitRuntime>

/** Async commit prerequisite run after preparation and before a generation becomes active. */
export type RuntimeGenerationBeforePublish = (candidate: PreparedRuntimeGeneration) => Promise<void>

async function defaultFactory(
  ctx: Context,
  config: ResolvedVisionToolkitConfig,
  readableStorageDirs: readonly string[],
): Promise<VisionToolkitRuntime> {
  const adapter = new UpstreamAdapter(ctx, config)
  await adapter.prepare()
  return new VisionToolkitRuntime(ctx, config, adapter, readableStorageDirs)
}

function fingerprint(config: ResolvedVisionToolkitConfig): string {
  // Transparent routing is a display/policy flag: toggling it must not rebuild
  // or re-verify the vision runtime, only reconcile the model-selector routes.
  return JSON.stringify({
    ...config,
    imageInputVariants: { ...config.imageInputVariants, hidden: false },
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Internal runtime source with prepare-before-swap semantics. */
export class VisionToolkitRuntimeManager {
  private active: PreparedRuntimeGeneration | undefined
  private generation = 0
  private reconfigureTicket = 0
  private lastError: string | undefined
  private validatedStartupStorageDir: string | null | undefined
  private readonly readableStorageDirs = new Set<string>()

  constructor(
    private readonly ctx: Context,
    private readonly factory: RuntimeGenerationFactory = defaultFactory,
  ) {}

  /** The currently serving runtime; unavailable until one generation prepares. */
  current(): VisionToolkitRuntime {
    if (this.active === undefined) throw new Error('dsh-vision-toolkit runtime is not ready')
    return this.active.runtime
  }

  /** Configuration belonging to the currently serving runtime generation. */
  currentConfig(): ResolvedVisionToolkitConfig {
    if (this.active === undefined) throw new Error('dsh-vision-toolkit runtime is not ready')
    return this.active.config
  }

  /** Whether at least one generation is available. */
  get ready(): boolean {
    return this.active !== undefined
  }

  /** Storage config safe for paste writes even when initial runtime preparation failed. */
  storageGeneration(): RuntimeStorageGeneration {
    if (this.active !== undefined) {
      return {
        generation: this.generation,
        ...(this.active.config.storageDir === undefined ? {} : { storageDir: this.active.config.storageDir }),
      }
    }
    if (this.validatedStartupStorageDir === undefined) {
      throw new Error('dsh-vision-toolkit storage configuration is not ready')
    }
    return {
      generation: this.generation,
      ...(this.validatedStartupStorageDir === null ? {} : { storageDir: this.validatedStartupStorageDir }),
    }
  }

  /** Validated storage for best-effort consumers; undefined when startup preflight failed. */
  validatedStorageDirectory(): string | undefined {
    if (this.active !== undefined) return this.active.config.storageDir
    return this.validatedStartupStorageDir ?? undefined
  }

  private async prepareResolvedCandidate(config: ResolvedVisionToolkitConfig): Promise<PreparedRuntimeGeneration> {
    const resolvedFingerprint = fingerprint(config)
    if (this.active?.fingerprint === resolvedFingerprint) {
      return { ...this.active, config }
    }
    const runtime = await this.factory(
      this.ctx,
      config,
      [...new Set([...this.readableStorageDirs, ...config.storageHistory])]
        .filter(storageDir => storageDir !== config.storageDir),
    )
    return { config, fingerprint: resolvedFingerprint, runtime }
  }

  private rememberStorageDirectory(storageDir: string | undefined): void {
    if (storageDir !== undefined) this.readableStorageDirs.add(storageDir)
  }

  private rememberStorageDirectories(storageDirs: readonly string[]): void {
    for (const storageDir of storageDirs) this.rememberStorageDirectory(storageDir)
  }

  /** Resolve and fully prepare a candidate without changing the active runtime. */
  async prepareCandidate(raw: VisionToolkitConfig): Promise<PreparedRuntimeGeneration> {
    const config = resolveConfig(raw)
    if (config.storageDir !== undefined) await preflightSharedStorageBase(config.storageDir)
    return this.prepareResolvedCandidate(config)
  }

  /**
   * Publish one already-prepared generation atomically.
   * @param candidate - generation returned by {@link prepareCandidate}.
   */
  activateCandidate(candidate: PreparedRuntimeGeneration): void {
    if (this.active?.fingerprint === candidate.fingerprint) {
      this.active = candidate
      this.lastError = undefined
      return
    }
    this.reconfigureTicket += 1
    this.active = candidate
    this.rememberStorageDirectories(candidate.config.storageHistory)
    this.rememberStorageDirectory(candidate.config.storageDir)
    this.generation += 1
    this.lastError = undefined
    this.ctx.logger.info(
      'dsh-vision-toolkit runtime generation=%d active (upstream %s @ %s, checkout %s)',
      this.generation,
      candidate.runtime.upstreamVersion.version,
      candidate.runtime.upstreamVersion.commit,
      candidate.runtime.upstreamVersion.path,
    )
  }

  /**
   * Prepare and publish the initial or explicitly validated generation.
   * @param raw - untrusted Settings generation to resolve and prepare.
   * @param beforePublish - optional durable prerequisite run after preparation.
   */
  async initialize(raw: VisionToolkitConfig, beforePublish?: RuntimeGenerationBeforePublish): Promise<void> {
    try {
      const config = resolveConfig(raw)
      if (config.storageDir !== undefined) await preflightSharedStorageBase(config.storageDir)
      this.validatedStartupStorageDir = config.storageDir ?? null
      this.rememberStorageDirectories(config.storageHistory)
      this.rememberStorageDirectory(config.storageDir)
      const candidate = await this.prepareResolvedCandidate(config)
      await beforePublish?.(candidate)
      this.activateCandidate(candidate)
    } catch (error) {
      this.lastError = messageOf(error)
      throw error
    }
  }

  /**
   * Apply an externally committed Settings generation. Concurrent edits are
   * last-write-wins; a slower obsolete prepare can never overwrite a newer one.
   * @param raw - externally committed Settings generation.
   * @param beforePublish - optional durable prerequisite run after preparation.
   * @returns whether this call published a new active generation.
   */
  async reconfigure(raw: VisionToolkitConfig, beforePublish?: RuntimeGenerationBeforePublish): Promise<boolean> {
    const ticket = ++this.reconfigureTicket
    let candidate: PreparedRuntimeGeneration
    try {
      candidate = await this.prepareCandidate(raw)
      if (ticket !== this.reconfigureTicket) return false
      await beforePublish?.(candidate)
    } catch (error) {
      if (ticket === this.reconfigureTicket) this.lastError = messageOf(error)
      throw error
    }
    if (ticket !== this.reconfigureTicket) return false
    const changed = this.active?.fingerprint !== candidate.fingerprint
    this.active = candidate
    this.rememberStorageDirectories(candidate.config.storageHistory)
    this.rememberStorageDirectory(candidate.config.storageDir)
    if (changed) {
      this.generation += 1
      this.ctx.logger.info(
        'dsh-vision-toolkit Settings activated runtime generation=%d (upstream %s @ %s, checkout %s)',
        this.generation,
        candidate.runtime.upstreamVersion.version,
        candidate.runtime.upstreamVersion.commit,
        candidate.runtime.upstreamVersion.path,
      )
    }
    this.lastError = undefined
    return changed
  }

  /** Record a failed preflight while retaining the previous generation. */
  recordFailure(error: unknown): void {
    this.lastError = messageOf(error)
  }

  /** Secret-free status snapshot for health/configuration surfaces. */
  status(): RuntimeManagerStatus {
    if (this.active === undefined) {
      return {
        ready: false,
        generation: this.generation,
        ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      }
    }
    return {
      ready: true,
      generation: this.generation,
      activeConfig: this.active.config,
      upstream: this.active.runtime.upstreamVersion,
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
    }
  }
}
