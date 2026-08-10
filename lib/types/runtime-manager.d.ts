/**
 * Atomic live configuration owner for the plugin's internal runtime. A new
 * upstream adapter is fully prepared before it replaces the currently serving
 * runtime, so failed Settings edits never interrupt in-flight or later calls.
 * @module dsh-vision-toolkit/runtime-manager
 */
import type { Context } from 'cordis';
import { type ResolvedVisionToolkitConfig, type VisionToolkitConfig } from './config.ts';
import { VisionToolkitRuntime } from './runtime.ts';
import { type UpstreamVersionInfo } from './upstream.ts';
/** One completely prepared configuration generation. */
export interface PreparedRuntimeGeneration {
    config: ResolvedVisionToolkitConfig;
    fingerprint: string;
    runtime: VisionToolkitRuntime;
}
/** Public, secret-free status used by the Settings page. */
export interface RuntimeManagerStatus {
    ready: boolean;
    generation: number;
    activeConfig?: ResolvedVisionToolkitConfig;
    upstream?: UpstreamVersionInfo;
    lastError?: string;
}
/** Test seam for preparing one generation. */
export type RuntimeGenerationFactory = (ctx: Context, config: ResolvedVisionToolkitConfig) => Promise<VisionToolkitRuntime>;
/** Internal runtime source with prepare-before-swap semantics. */
export declare class VisionToolkitRuntimeManager {
    private readonly ctx;
    private readonly factory;
    private active;
    private generation;
    private reconfigureTicket;
    private lastError;
    constructor(ctx: Context, factory?: RuntimeGenerationFactory);
    /** The currently serving runtime; unavailable until one generation prepares. */
    current(): VisionToolkitRuntime;
    /** Whether at least one generation is available. */
    get ready(): boolean;
    /** Resolve and fully prepare a candidate without changing the active runtime. */
    prepareCandidate(raw: VisionToolkitConfig): Promise<PreparedRuntimeGeneration>;
    /**
     * Publish one already-prepared generation atomically.
     * @param candidate - generation returned by {@link prepareCandidate}.
     */
    activateCandidate(candidate: PreparedRuntimeGeneration): void;
    /** Prepare and publish the initial or explicitly validated generation. */
    initialize(raw: VisionToolkitConfig): Promise<void>;
    /**
     * Apply an externally committed Settings generation. Concurrent edits are
     * last-write-wins; a slower obsolete prepare can never overwrite a newer one.
     * @returns whether this call published a new active generation.
     */
    reconfigure(raw: VisionToolkitConfig): Promise<boolean>;
    /** Record a failed preflight while retaining the previous generation. */
    recordFailure(error: unknown): void;
    /** Secret-free status snapshot for health/configuration surfaces. */
    status(): RuntimeManagerStatus;
}
//# sourceMappingURL=runtime-manager.d.ts.map