/**
 * Atomic live configuration owner for the plugin's internal runtime. A new
 * upstream adapter is fully prepared before it replaces the currently serving
 * runtime, so failed Settings edits never interrupt in-flight or later calls.
 * @module dsh-vision-toolkit/runtime-manager
 */
import { resolveConfig } from "./config.js";
import { VisionToolkitRuntime } from "./runtime.js";
import { UpstreamAdapter } from "./upstream.js";
async function defaultFactory(ctx, config) {
    const adapter = new UpstreamAdapter(ctx, config);
    await adapter.prepare();
    return new VisionToolkitRuntime(ctx, config, adapter);
}
function fingerprint(config) {
    // Transparent routing is a display/policy flag: toggling it must not rebuild
    // or re-verify the vision runtime, only reconcile the model-selector routes.
    return JSON.stringify({
        ...config,
        imageInputVariants: { ...config.imageInputVariants, hidden: false },
    });
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Internal runtime source with prepare-before-swap semantics. */
export class VisionToolkitRuntimeManager {
    ctx;
    factory;
    active;
    generation = 0;
    reconfigureTicket = 0;
    lastError;
    constructor(ctx, factory = defaultFactory) {
        this.ctx = ctx;
        this.factory = factory;
    }
    /** The currently serving runtime; unavailable until one generation prepares. */
    current() {
        if (this.active === undefined)
            throw new Error('dsh-vision-toolkit runtime is not ready');
        return this.active.runtime;
    }
    /** Whether at least one generation is available. */
    get ready() {
        return this.active !== undefined;
    }
    /** Resolve and fully prepare a candidate without changing the active runtime. */
    async prepareCandidate(raw) {
        const config = resolveConfig(raw);
        const resolvedFingerprint = fingerprint(config);
        if (this.active?.fingerprint === resolvedFingerprint) {
            return { ...this.active, config };
        }
        const runtime = await this.factory(this.ctx, config);
        return { config, fingerprint: resolvedFingerprint, runtime };
    }
    /**
     * Publish one already-prepared generation atomically.
     * @param candidate - generation returned by {@link prepareCandidate}.
     */
    activateCandidate(candidate) {
        if (this.active?.fingerprint === candidate.fingerprint) {
            this.active = candidate;
            this.lastError = undefined;
            return;
        }
        this.reconfigureTicket += 1;
        this.active = candidate;
        this.generation += 1;
        this.lastError = undefined;
        this.ctx.logger.info('dsh-vision-toolkit runtime generation=%d active (upstream %s @ %s, checkout %s)', this.generation, candidate.runtime.upstreamVersion.version, candidate.runtime.upstreamVersion.commit, candidate.runtime.upstreamVersion.path);
    }
    /** Prepare and publish the initial or explicitly validated generation. */
    async initialize(raw) {
        try {
            this.activateCandidate(await this.prepareCandidate(raw));
        }
        catch (error) {
            this.lastError = messageOf(error);
            throw error;
        }
    }
    /**
     * Apply an externally committed Settings generation. Concurrent edits are
     * last-write-wins; a slower obsolete prepare can never overwrite a newer one.
     * @returns whether this call published a new active generation.
     */
    async reconfigure(raw) {
        const ticket = ++this.reconfigureTicket;
        let candidate;
        try {
            candidate = await this.prepareCandidate(raw);
        }
        catch (error) {
            if (ticket === this.reconfigureTicket)
                this.lastError = messageOf(error);
            throw error;
        }
        if (ticket !== this.reconfigureTicket)
            return false;
        const changed = this.active?.fingerprint !== candidate.fingerprint;
        this.active = candidate;
        if (changed) {
            this.generation += 1;
            this.ctx.logger.info('dsh-vision-toolkit Settings activated runtime generation=%d (upstream %s @ %s, checkout %s)', this.generation, candidate.runtime.upstreamVersion.version, candidate.runtime.upstreamVersion.commit, candidate.runtime.upstreamVersion.path);
        }
        this.lastError = undefined;
        return changed;
    }
    /** Record a failed preflight while retaining the previous generation. */
    recordFailure(error) {
        this.lastError = messageOf(error);
    }
    /** Secret-free status snapshot for health/configuration surfaces. */
    status() {
        if (this.active === undefined) {
            return {
                ready: false,
                generation: this.generation,
                ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
            };
        }
        return {
            ready: true,
            generation: this.generation,
            activeConfig: this.active.config,
            upstream: this.active.runtime.upstreamVersion,
            ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
        };
    }
}
//# sourceMappingURL=runtime-manager.js.map