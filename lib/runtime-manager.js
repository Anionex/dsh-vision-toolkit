/**
 * Atomic live configuration owner for the plugin's internal runtime. A new
 * upstream adapter is fully prepared before it replaces the currently serving
 * runtime, so failed Settings edits never interrupt in-flight or later calls.
 * @module dsh-vision-toolkit/runtime-manager
 */
import { resolveConfig } from "./config.js";
import { preflightSharedStorageBase } from "./paths.js";
import { VisionToolkitRuntime } from "./runtime.js";
import { UpstreamAdapter } from "./upstream.js";
async function defaultFactory(ctx, config, readableStorageDirs, signal) {
    const adapter = new UpstreamAdapter(ctx, config);
    await adapter.prepare(signal);
    return new VisionToolkitRuntime(ctx, config, adapter, readableStorageDirs);
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
    validatedStartupStorageDir;
    readableStorageDirs = new Set();
    lifetime = new AbortController();
    preparation;
    pending;
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
    /** Configuration belonging to the currently serving runtime generation. */
    currentConfig() {
        if (this.active === undefined)
            throw new Error('dsh-vision-toolkit runtime is not ready');
        return this.active.config;
    }
    /** Whether at least one generation is available. */
    get ready() {
        return this.active !== undefined;
    }
    /** Start preparation without holding up Profile boot. */
    start(raw, beforePublish) {
        return this.initialize(raw, beforePublish);
    }
    track(pending) {
        this.pending = pending;
        void pending.catch(() => { });
        return pending;
    }
    /** Wait for the first generation; a caller cancellation does not cancel shared preparation. */
    async whenReady(signal) {
        const combined = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal]);
        combined.throwIfAborted();
        if (this.active !== undefined)
            return this.active.runtime;
        let abort;
        const cancelled = new Promise((_resolve, reject) => {
            abort = () => reject(combined.reason);
            combined.addEventListener('abort', abort, { once: true });
        });
        try {
            while (true) {
                const pending = this.pending;
                try {
                    await Promise.race([pending, cancelled]);
                }
                catch (error) {
                    combined.throwIfAborted();
                    if (pending !== this.pending)
                        continue;
                    throw error;
                }
                combined.throwIfAborted();
                if (this.ready)
                    return this.current();
                if (pending === this.pending)
                    return this.current();
            }
        }
        finally {
            combined.removeEventListener('abort', abort);
        }
    }
    /** Invalidate queued generations and cancel their subprocesses/downloads. */
    dispose() {
        this.reconfigureTicket += 1;
        this.lifetime.abort();
        this.preparation?.abort();
    }
    /** Storage config safe for paste writes even when initial runtime preparation failed. */
    storageGeneration() {
        if (this.active !== undefined) {
            return {
                generation: this.generation,
                ...(this.active.config.storageDir === undefined ? {} : { storageDir: this.active.config.storageDir }),
            };
        }
        if (this.validatedStartupStorageDir === undefined) {
            throw new Error('dsh-vision-toolkit storage configuration is not ready');
        }
        return {
            generation: this.generation,
            ...(this.validatedStartupStorageDir === null ? {} : { storageDir: this.validatedStartupStorageDir }),
        };
    }
    /** Validated storage for best-effort consumers; undefined when startup preflight failed. */
    validatedStorageDirectory() {
        if (this.active !== undefined)
            return this.active.config.storageDir;
        return this.validatedStartupStorageDir ?? undefined;
    }
    async prepareResolvedCandidate(config, signal = this.lifetime.signal) {
        signal.throwIfAborted();
        const resolvedFingerprint = fingerprint(config);
        if (this.active?.fingerprint === resolvedFingerprint) {
            return { ...this.active, config };
        }
        const runtime = await this.factory(this.ctx, config, [...new Set([...this.readableStorageDirs, ...config.storageHistory])]
            .filter(storageDir => storageDir !== config.storageDir), signal);
        signal.throwIfAborted();
        return { config, fingerprint: resolvedFingerprint, runtime };
    }
    rememberStorageDirectory(storageDir) {
        if (storageDir !== undefined)
            this.readableStorageDirs.add(storageDir);
    }
    rememberStorageDirectories(storageDirs) {
        for (const storageDir of storageDirs)
            this.rememberStorageDirectory(storageDir);
    }
    /** Resolve and fully prepare a candidate without changing the active runtime. */
    async prepareCandidate(raw) {
        const config = resolveConfig(raw);
        if (config.storageDir !== undefined)
            await preflightSharedStorageBase(config.storageDir);
        return this.prepareResolvedCandidate(config);
    }
    /**
     * Publish one already-prepared generation atomically.
     * @param candidate - generation returned by {@link prepareCandidate}.
     */
    activateCandidate(candidate) {
        this.lifetime.signal.throwIfAborted();
        if (this.active?.fingerprint === candidate.fingerprint) {
            this.active = candidate;
            this.lastError = undefined;
            return;
        }
        this.reconfigureTicket += 1;
        this.active = candidate;
        this.rememberStorageDirectories(candidate.config.storageHistory);
        this.rememberStorageDirectory(candidate.config.storageDir);
        this.generation += 1;
        this.lastError = undefined;
        this.ctx.logger.info('dsh-vision-toolkit runtime generation=%d active (upstream %s @ %s, checkout %s)', this.generation, candidate.runtime.upstreamVersion.version, candidate.runtime.upstreamVersion.commit, candidate.runtime.upstreamVersion.path);
    }
    /**
     * Prepare and publish the initial or explicitly validated generation.
     * @param raw - untrusted Settings generation to resolve and prepare.
     * @param beforePublish - optional durable prerequisite run after preparation.
     */
    initialize(raw, beforePublish) {
        return this.track(this.initializeGeneration(raw, beforePublish));
    }
    async initializeGeneration(raw, beforePublish) {
        const ticket = ++this.reconfigureTicket;
        this.preparation?.abort();
        const controller = this.preparation = new AbortController();
        const signal = AbortSignal.any([controller.signal, this.lifetime.signal]);
        try {
            const config = resolveConfig(raw);
            if (config.storageDir !== undefined)
                await preflightSharedStorageBase(config.storageDir);
            this.validatedStartupStorageDir = config.storageDir ?? null;
            this.rememberStorageDirectories(config.storageHistory);
            this.rememberStorageDirectory(config.storageDir);
            const candidate = await this.prepareResolvedCandidate(config, signal);
            if (ticket !== this.reconfigureTicket)
                return;
            await beforePublish?.(candidate);
            signal.throwIfAborted();
            if (ticket !== this.reconfigureTicket)
                return;
            this.activateCandidate(candidate);
        }
        catch (error) {
            if (ticket === this.reconfigureTicket)
                this.lastError = messageOf(error);
            throw error;
        }
    }
    /**
     * Apply an externally committed Settings generation. Concurrent edits are
     * last-write-wins; a slower obsolete prepare can never overwrite a newer one.
     * @param raw - externally committed Settings generation.
     * @param beforePublish - optional durable prerequisite run after preparation.
     * @returns whether this call published a new active generation.
     */
    reconfigure(raw, beforePublish) {
        return this.track(this.reconfigureGeneration(raw, beforePublish));
    }
    async reconfigureGeneration(raw, beforePublish) {
        const ticket = ++this.reconfigureTicket;
        this.preparation?.abort();
        const controller = this.preparation = new AbortController();
        const signal = AbortSignal.any([controller.signal, this.lifetime.signal]);
        let candidate;
        try {
            const config = resolveConfig(raw);
            if (config.storageDir !== undefined)
                await preflightSharedStorageBase(config.storageDir);
            candidate = await this.prepareResolvedCandidate(config, signal);
            if (ticket !== this.reconfigureTicket)
                return false;
            await beforePublish?.(candidate);
            signal.throwIfAborted();
        }
        catch (error) {
            if (ticket === this.reconfigureTicket)
                this.lastError = messageOf(error);
            if (ticket !== this.reconfigureTicket)
                return false;
            throw error;
        }
        if (ticket !== this.reconfigureTicket)
            return false;
        const changed = this.active?.fingerprint !== candidate.fingerprint;
        this.active = candidate;
        this.rememberStorageDirectories(candidate.config.storageHistory);
        this.rememberStorageDirectory(candidate.config.storageDir);
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