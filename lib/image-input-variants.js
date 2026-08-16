/**
 * Image-input variants: sibling model-selector entries for every model the
 * host positively declares text-only. A variant declares image input, so
 * pasted images keep the native attachment flow — composer thumbnail and the
 * durable session image — while the variant's stream rewrites every image
 * block into a Vision Toolkit description before delegating to the original
 * route. The durable log is untouched; only the wire carries text.
 * @module dsh-vision-toolkit/image-input-variants
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmAdapter, contentHasImage } from '@deepseek-ai/dsh-llm';
/** Provider-id prefix for the variant routes this plugin registers. */
export const VARIANT_PROVIDER_PREFIX = 'vision-toolkit-';
/** Display suffix shared by variant provider names and variant model names. */
export const VARIANT_SUFFIX = ' (Vision Toolkit)';
/** Promise-cache bound for image descriptions, so a long-lived Web profile cannot hoard evidence text. */
const EVIDENCE_CACHE_LIMIT = 64;
/**
 * Media types the Vision Toolkit glance pipeline accepts, by declared media
 * type. Narrower than the paste-to-workspace route (which stores any image
 * type): a paste of an unsupported type on a variant session degrades loudly
 * on the wire instead of being described.
 */
const MEDIA_EXTENSIONS = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
};
/** Model-facing prefix on converted image blocks. */
const DESCRIBED_PREFIX = '[Image described by the Vision Toolkit]\n';
/** Model-facing prefix on degraded conversions; the model must never guess at image content. */
const DEGRADED_PREFIX = '[The Vision Toolkit could not describe this image: ';
/** The variant provider route minted for one upstream route. */
export function variantProviderId(upstream) {
    return `${VARIANT_PROVIDER_PREFIX}${upstream}`;
}
/**
 * Whether one model earns an image-input variant: the host must positively
 * declare it text-only. A model with unknown modalities is left alone — its
 * native channel is the safe default, and the variant would degrade it.
 * @param info - model metadata from the host catalog.
 * @returns true when the model is confirmed text-only.
 */
export function shouldWrapModel(info) {
    return Array.isArray(info.inputModalities) && !info.inputModalities.includes('image');
}
/** Whether a content block list carries an image at any depth (tool-result nesting included). */
export { contentHasImage } from '@deepseek-ai/dsh-llm';
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Bounded promise cache for one attachment's description; failed reads are not retained. */
export class EvidenceCache {
    limit;
    entries = new Map();
    constructor(limit) {
        this.limit = limit;
    }
    /**
     * Read one key's entry or compute it. Concurrent readers join the in-flight
     * computation; a settled failure is evicted so a fixed configuration gets a
     * fresh chance.
     * @param key - the attachment identity (content-addressed).
     * @param load - computes the description; must resolve `{ ok, block }` and never reject.
     * @returns the cached or computed block.
     */
    read(key, load) {
        const existing = this.entries.get(key);
        if (existing !== undefined) {
            // Refresh recency: Map iteration order is insertion order.
            this.entries.delete(key);
            this.entries.set(key, existing);
            return existing;
        }
        const pending = load().then((result) => {
            // Only evict our own entry: this promise may have been LRU-evicted and
            // the key re-populated by a newer read meanwhile.
            if (!result.ok && this.entries.get(key) === pending) {
                this.entries.delete(key);
            }
            return result.block;
        }, (error) => {
            if (this.entries.get(key) === pending) {
                this.entries.delete(key);
            }
            throw error;
        });
        this.entries.set(key, pending);
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined)
                break;
            this.entries.delete(oldest);
        }
        return pending;
    }
    /** Drop every cached description (runtime reconfiguration invalidates provider-specific reads). */
    clear() {
        this.entries.clear();
    }
}
/**
 * Wait on a shared promise without inheriting its lifetime: the caller's
 * abort rejects this wait immediately, while the underlying read keeps
 * running and lands in the cache for the retry.
 * @param promise - the shared computation.
 * @param signal - the caller's cancellation, or undefined to wait unconditionally.
 * @returns the computed value, unless the caller aborted first.
 */
export function abortableWait(promise, signal) {
    if (signal === undefined)
        return promise;
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason ?? new Error('aborted'));
            return;
        }
        const onAbort = () => { reject(signal.reason ?? new Error('aborted')); };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}
async function convertBlocks(blocks, convert) {
    const out = [];
    for (const block of blocks) {
        if (block.type === 'image') {
            out.push(await convert(block));
        }
        else if (block.type === 'tool-result' && contentHasImage(block.content)) {
            out.push({ ...block, content: await convertBlocks(block.content, convert) });
        }
        else {
            out.push(block);
        }
    }
    return out;
}
/**
 * Read one image block into a Vision Toolkit description text block. Never
 * throws: failures degrade to an explanatory block with `ok: false`, so the
 * caller can decide what a failure means (the cache refuses to memoize it).
 * @param ctx - plugin context; reads the optional `attachments` service.
 * @param runtime - the currently serving Vision Toolkit runtime, if ready.
 * @param block - the image block to describe.
 * @returns the outcome and its model-facing replacement block.
 */
async function readImageBlock(ctx, runtime, block) {
    const attachments = ctx.get('attachments');
    const current = runtime();
    if (attachments === undefined || current === undefined) {
        return { ok: false, block: { type: 'text', text: `${DEGRADED_PREFIX}the Vision Toolkit runtime is not ready.]` } };
    }
    const extension = MEDIA_EXTENSIONS[block.attachment.mediaType];
    if (extension === undefined) {
        return { ok: false, block: { type: 'text', text: `${DEGRADED_PREFIX}unsupported image media type ${block.attachment.mediaType}.]` } };
    }
    let directory;
    try {
        // The glance pipeline validates paths against the workspace it is given,
        // so the temp copy lives in a dedicated directory passed as that workspace.
        const stored = await attachments.readImage(block.attachment);
        directory = await mkdtemp(join(tmpdir(), 'dsh-vision-toolkit-'));
        const file = join(directory, `image${extension}`);
        await writeFile(file, Buffer.from(stored.data), { mode: 0o600 });
        // A fresh signal on purpose: the cached run must not die with its first
        // caller (their abort used to cancel every concurrent joiner); the runtime
        // deadline still bounds it.
        const result = await current.glance({ images: [file] }, { signal: new AbortController().signal, workspace: directory });
        const answer = result.answer.trim();
        if (answer.length === 0)
            throw new Error('the Vision Toolkit returned an empty description');
        return { ok: true, block: { type: 'text', text: `${DESCRIBED_PREFIX}${answer}` } };
    }
    catch (error) {
        return {
            ok: false,
            block: { type: 'text', text: `${DEGRADED_PREFIX}${messageOf(error).slice(0, 300)}.]` },
        };
    }
    finally {
        if (directory !== undefined) {
            await rm(directory, { recursive: true, force: true }).catch(() => { });
        }
    }
}
/**
 * Rewrite image blocks in one message list into description text blocks.
 * The original messages are returned untouched when nothing carries an image;
 * converted messages are new objects, so the durable request stays immutable.
 * @param ctx - plugin context for the attachments service.
 * @param runtime - the currently serving runtime (lazily read per conversion).
 * @param cache - shared per-adapter description cache.
 * @param messages - the assembled request messages.
 * @param signal - the caller's cancellation for this conversion pass.
 * @returns the rewritten message list.
 */
export async function convertImagesToEvidence(ctx, runtime, cache, messages, signal) {
    const out = [];
    for (const message of messages) {
        if (!contentHasImage(message.content)) {
            out.push(message);
            continue;
        }
        const content = await convertBlocks(message.content, (block) => abortableWait(cache.read(String(block.attachment.attachmentId), () => readImageBlock(ctx, runtime, block)), signal));
        out.push({ ...message, content });
    }
    return out;
}
/**
 * The adapter behind one variant route: model metadata declares image input,
 * and every stream rewrites image blocks before delegating to the upstream
 * route through the host service (so the upstream route's own middleware,
 * retry policy, and replay handling still apply).
 */
export class ImageInputVariantAdapter extends LlmAdapter {
    ctx;
    llm;
    upstream;
    upstreamName;
    runtime;
    cache;
    lastRuntime;
    constructor(ctx, llm, upstream, upstreamName, runtime, cache) {
        super();
        this.ctx = ctx;
        this.llm = llm;
        this.upstream = upstream;
        this.upstreamName = upstreamName;
        this.runtime = runtime;
        this.cache = cache;
    }
    providerInfo(provider) {
        return { id: provider, name: `${this.upstreamName}${VARIANT_SUFFIX}` };
    }
    async listModels(provider) {
        const models = await this.llm.listModels(this.upstream);
        return models.filter(shouldWrapModel).map((model) => ({
            provider,
            id: model.id,
            name: `${model.name}${VARIANT_SUFFIX}`,
            inputModalities: ['text', 'image'],
            ...(model.description === undefined ? {} : { description: model.description }),
        }));
    }
    async resolveModel(provider, model, signal) {
        const info = await this.llm.resolveModelInfo(this.upstream, model, signal);
        if (!shouldWrapModel(info)) {
            throw new Error(`model "${model}" is not a text-only model and needs no image-input variant`);
        }
        return {
            provider,
            id: model,
            name: `${info.name}${VARIANT_SUFFIX}`,
            inputModalities: ['text', 'image'],
            ...(info.description === undefined ? {} : { description: info.description }),
            // Capability and call-default metadata rides through unchanged: the
            // variant is a wire-only facade, so context capacity, output caps, and
            // reasoning efforts must behave exactly like the upstream route.
            ...(info.context === undefined ? {} : { context: info.context }),
            ...(info.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: info.defaultMaxTokens }),
            ...(info.reasoning === undefined ? {} : { reasoning: info.reasoning }),
        };
    }
    async *stream(options) {
        // A reconfigured runtime is a NEW instance; descriptions read through the
        // previous provider must not be replayed for the new one.
        const current = this.runtime();
        if (current !== this.lastRuntime) {
            this.cache.clear();
            this.lastRuntime = current;
        }
        const messages = await convertImagesToEvidence(this.ctx, this.runtime, this.cache, options.messages, options.signal);
        // Delegate through the host service under the upstream route: the variant
        // is a wire-only facade, and the upstream route owns retry and replay.
        yield* this.llm.stream({ ...options, provider: this.upstream, messages });
    }
}
/**
 * Whether the plugin should take a paste over for one live Session: true only
 * when the current model is positively declared text-only. The model-selector
 * label is the authoritative source when supplied — the Session's persisted
 * route header only updates on a request, so a model switch would otherwise be
 * invisible until the next turn — with a fallback to that header. Unknown
 * routes answer false: the native attachment flow is the safe default, and a
 * text-only model merely keeps its ordinary image-admission error.
 * @param ctx - plugin context with `sessions` and `llm`.
 * @param sessionId - the live Session id the paste belongs to.
 * @param modelLabel - the model-selector label the client currently shows, if any.
 * @returns true when pastes should become workspace paths instead of attachments.
 */
export async function sessionPasteTakeover(ctx, sessionId, modelLabel) {
    if (modelLabel !== undefined && modelLabel.trim() !== '') {
        const byLabel = await labelTakeoverVerdict(ctx, modelLabel);
        if (byLabel !== undefined)
            return byLabel;
    }
    return sessionHeaderTakeover(ctx, sessionId);
}
/**
 * Resolve the takeover verdict from the Session's last requested route header.
 * @param ctx - plugin context with `sessions` and `llm`.
 * @param sessionId - the live Session id.
 * @returns true when the persisted route is positively text-only.
 */
export async function sessionHeaderTakeover(ctx, sessionId) {
    const session = ctx.sessions.get(sessionId);
    if (session === undefined)
        return false;
    const routed = session.requestHeader()?.config;
    if (routed === undefined)
        return false;
    const llm = ctx.get('llm');
    if (llm === undefined)
        return false;
    let info;
    try {
        info = await llm.resolveModelInfo(routed.provider, routed.model);
    }
    catch {
        return false;
    }
    return shouldWrapModel(info);
}
/**
 * Resolve the takeover verdict from a model-selector label alone. Every model
 * whose name or id appears in the label votes: any image-capable (or unknown-
 * capability) match vetoes the takeover, and at least one positively text-only
 * match confirms it. A route whose catalog cannot be read also vetoes — the
 * unreadable route is exactly where an image-capable twin could hide, so a
 * label match on a half-read catalog must not confirm a takeover. The label
 * carries no provider id, so no picking is attempted: the answer is decisive
 * only when the whole catalog was walkable and every match agrees.
 * @param ctx - plugin context with the `llm` service.
 * @param label - the selector label the browser shows.
 * @returns true (take over), false (native), or undefined when nothing matched.
 */
export async function labelTakeoverVerdict(ctx, label) {
    const llm = ctx.get('llm');
    if (llm === undefined)
        return undefined;
    const lowered = label.toLowerCase();
    let matchedTextOnly = false;
    for (const provider of llm.listProviders()) {
        let models;
        try {
            models = await llm.listModels(provider.id);
        }
        catch (error) {
            // An unreadable route cannot vote — and it is exactly where an
            // image-capable twin could hide (a variant route probes its upstream).
            // A label match on a half-read catalog must not confirm a takeover, so
            // the verdict is vetoed for THIS label; the session header fallback is
            // deliberately not used here because it may still describe a previous
            // model after a switch. Loud, so a broken provider is diagnosable.
            ctx.logger.warn('dsh-vision-toolkit: paste verdict could not read route "%s"; native paste wins for this label. %s', provider.id, messageOf(error).slice(0, 300));
            return false;
        }
        for (const model of models) {
            for (const candidate of [model.name, model.id]) {
                if (typeof candidate !== 'string' || candidate.length === 0)
                    continue;
                if (!lowered.includes(candidate.toLowerCase()))
                    continue;
                if (!shouldWrapModel(model)) {
                    // An image-capable or unconfirmed model in the label keeps its
                    // native paste; the variant routes declare image input and are
                    // covered by this veto.
                    return false;
                }
                // Positive confirmation has a floor: one- and two-character names
                // match label prose far too easily to identify the selected model.
                if (candidate.length >= 3)
                    matchedTextOnly = true;
            }
        }
    }
    return matchedTextOnly ? true : undefined;
}
/** Label-verdict cache bound, so a long-lived Web profile cannot hoard catalog walks. */
const LABEL_VERDICT_TTL_MS = 15_000;
const LABEL_VERDICT_CAP = 32;
/**
 * Resolve the paste verdict for one exact model route. Image-capable (or
 * unresolvable) routes keep the native flow; a text-only route whose
 * image-input variant is registered gets an auto-switch instruction; a
 * text-only route without a usable variant falls back to the path takeover.
 * @param ctx - plugin context with the `llm` service.
 * @param getConfig - resolves the current plugin configuration.
 * @param selection - the exact provider/model the browser currently selects.
 * @returns the verdict for that route.
 */
async function routePasteVerdict(ctx, getConfig, selection) {
    const llm = ctx.get('llm');
    if (llm === undefined)
        return { takeOver: false };
    let info;
    try {
        info = await llm.resolveModelInfo(selection.provider, selection.model);
    }
    catch {
        // An unresolvable route keeps the native flow; the host's own admission
        // error is the honest answer for a model that cannot take images.
        return { takeOver: false };
    }
    if (!shouldWrapModel(info))
        return { takeOver: false };
    const variants = getConfig().imageInputVariants;
    // Auto-switch is an opt-in refinement of the takeover: off means the
    // text-only route keeps its ordinary path takeover.
    if (!variants.enabled || !variants.autoSwitch)
        return { takeOver: true };
    const variantProvider = variantProviderId(selection.provider);
    try {
        if (!llm.listProviders().some(provider => provider.id === variantProvider))
            return { takeOver: true };
        const models = await llm.listModels(variantProvider);
        const twin = models.find(model => model.id === selection.model);
        // The variant only wraps text-only models, so membership confirms both
        // the route and the wrap; anything else keeps the path takeover.
        if (twin === undefined)
            return { takeOver: true };
        return {
            takeOver: false,
            autoSwitch: {
                provider: variantProvider,
                model: selection.model,
                label: twin.name,
                ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
            },
        };
    }
    catch {
        return { takeOver: true };
    }
}
/**
 * Paste-policy resolver with a short cache. The exact route is the live fact
 * (the browser re-reads it per paste), and the host catalog only changes on
 * topology events, so a brief cache is safe; every `llm/adapters-updated`
 * notification empties it — including the sweep that registers a variant
 * after the first sweep, so a stale "no variant" verdict cannot outlive the
 * route it described.
 * @param ctx - plugin context with the `llm` service.
 * @param getConfig - resolves the current plugin configuration per verdict.
 * @returns the cached verdict resolver for the Web paste-policy route.
 */
export function createPasteTakeoverResolver(ctx, getConfig) {
    const routes = new Map();
    const labels = new Map();
    const trim = (map) => {
        while (map.size > LABEL_VERDICT_CAP) {
            const oldest = map.keys().next().value;
            if (oldest === undefined)
                break;
            map.delete(oldest);
        }
    };
    if (typeof ctx.on === 'function') {
        ctx.on('llm/adapters-updated', () => {
            routes.clear();
            labels.clear();
        });
    }
    return async (sessionId, selection, modelLabel) => {
        if (selection !== undefined && selection.provider.trim() !== '' && selection.model.trim() !== '') {
            const key = `route:${selection.provider}|${selection.model}`;
            const cached = routes.get(key);
            if (cached !== undefined && Date.now() - cached.at <= LABEL_VERDICT_TTL_MS)
                return cached.verdict;
            const verdict = await routePasteVerdict(ctx, getConfig, selection);
            routes.set(key, { verdict, at: Date.now() });
            trim(routes);
            return verdict;
        }
        if (modelLabel !== undefined && modelLabel.trim() !== '') {
            const key = `label:${modelLabel}`;
            const cached = labels.get(key);
            if (cached !== undefined && Date.now() - cached.at <= LABEL_VERDICT_TTL_MS) {
                return { takeOver: cached.takeOver ?? (await sessionHeaderTakeover(ctx, sessionId)) };
            }
            const verdict = await labelTakeoverVerdict(ctx, modelLabel);
            // A decisive answer AND a miss are both cached: a label that matches
            // nothing would otherwise pay a full catalog walk on every paste.
            labels.set(key, { takeOver: verdict, at: Date.now() });
            trim(labels);
            return { takeOver: verdict ?? (await sessionHeaderTakeover(ctx, sessionId)) };
        }
        return { takeOver: await sessionHeaderTakeover(ctx, sessionId) };
    };
}
/**
 * Register and maintain one variant route per eligible upstream route. Routes
 * that later vanish are released; routes that gain eligible models later are
 * picked up by the next sweep (host topology notifications included).
 * @param ctx - plugin context with the `llm` service.
 * @param getConfig - resolves the current plugin configuration per sweep.
 * @param getRuntime - the currently serving Vision Toolkit runtime, if ready.
 * @returns the disposer and a manual re-sweep trigger (settings changes).
 */
export function installImageInputVariants(ctx, getConfig, getRuntime) {
    const registrations = new Map();
    let disposed = false;
    // Serialize sweeps: a registration itself announces llm/adapters-updated,
    // and two interleaved sweeps must never probe the same route concurrently.
    let sweeping = Promise.resolve();
    // Coalesce bursts: a sweep triggered while one is pending is one extra pass,
    // not one per notification (a single registration emits a notification).
    let sweepQueued = false;
    const releaseAll = () => {
        for (const dispose of [...registrations.values()])
            dispose();
        registrations.clear();
    };
    const sweep = () => {
        if (sweepQueued)
            return;
        sweepQueued = true;
        queueMicrotask(() => {
            sweepQueued = false;
            sweeping = sweeping.then(sweepOnce, sweepOnce);
        });
    };
    const sweepOnce = async () => {
        if (disposed)
            return;
        try {
            const variants = getConfig().imageInputVariants;
            if (!variants.enabled) {
                releaseAll();
                return;
            }
            const llm = ctx.get('llm');
            if (llm === undefined)
                return;
            const restrict = new Set(variants.providers);
            let providers;
            try {
                providers = llm.listProviders();
            }
            catch {
                return;
            }
            for (const provider of providers) {
                const upstream = provider.id;
                if (restrict.size > 0 && !restrict.has(upstream))
                    continue;
                // Our own variant routes declare image input and are never wrapped;
                // probing them would just re-probe their upstream route.
                if (upstream.startsWith(VARIANT_PROVIDER_PREFIX))
                    continue;
                let models;
                try {
                    models = await llm.listModels(upstream);
                }
                catch {
                    continue;
                }
                const eligible = models.some(shouldWrapModel);
                const registered = registrations.has(upstream);
                if (!eligible && registered) {
                    // The route lost its eligible models: release the stale variant.
                    const dispose = registrations.get(upstream);
                    dispose?.();
                    registrations.delete(upstream);
                    continue;
                }
                if (!eligible || registered)
                    continue;
                if (disposed)
                    return;
                try {
                    const dispose = llm.registerAdapter([variantProviderId(upstream)], new ImageInputVariantAdapter(ctx, llm, upstream, provider.name, getRuntime, new EvidenceCache(EVIDENCE_CACHE_LIMIT)));
                    registrations.set(upstream, dispose);
                }
                catch (error) {
                    ctx.logger.warn('dsh-vision-toolkit: image-input variant registration skipped for "%s": %s', upstream, messageOf(error));
                }
            }
            const live = new Set(providers.map(provider => provider.id));
            for (const [upstream, dispose] of [...registrations]) {
                // A wrapper is released when its upstream route vanished OR the
                // current configuration no longer allows that route (restrict
                // narrowing must not leave stale variants behind).
                if (!live.has(upstream) || (restrict.size > 0 && !restrict.has(upstream))) {
                    dispose();
                    registrations.delete(upstream);
                }
            }
        }
        catch (error) {
            ctx.logger.warn('dsh-vision-toolkit: image-input variant sweep failed: %s', messageOf(error));
        }
    };
    if (typeof ctx.on === 'function') {
        ctx.on('llm/adapters-updated', () => { sweep(); });
    }
    sweep();
    return {
        dispose: () => {
            disposed = true;
            releaseAll();
        },
        reconcile: () => { sweep(); },
    };
}
//# sourceMappingURL=image-input-variants.js.map