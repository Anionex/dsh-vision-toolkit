/**
 * Image-input variants: sibling model-selector entries for every model the
 * host positively declares text-only. A variant declares image input, so
 * pasted images keep the native attachment flow — composer thumbnail and the
 * durable session image — while the variant's stream rewrites every image
 * block into a Vision Toolkit description before delegating to the original
 * route. The durable log is untouched; only the wire carries text.
 * @module dsh-vision-toolkit/image-input-variants
 */
import type { Context } from '@deepseek-ai/cordis';
import LlmService, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, Message, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ResolvedVisionToolkitConfig } from './config.ts';
import type { PasteSelectionQuery, PasteVerdict } from './paste-images.ts';
import type { VisionToolkitRuntime } from './runtime.ts';
/** Provider-id prefix for the variant routes this plugin registers. */
export declare const VARIANT_PROVIDER_PREFIX = "vision-toolkit-";
/** Display suffix shared by variant provider names and variant model names. */
export declare const VARIANT_SUFFIX = " (Vision Toolkit)";
/** The variant provider route minted for one upstream route. */
export declare function variantProviderId(upstream: string): string;
/**
 * Whether one model earns an image-input variant: the host must positively
 * declare it text-only. A model with unknown modalities is left alone — its
 * native channel is the safe default, and the variant would degrade it.
 * @param info - model metadata from the host catalog.
 * @returns true when the model is confirmed text-only.
 */
export declare function shouldWrapModel(info: Pick<LlmModelInfo, 'inputModalities'>): boolean;
/** Whether a content block list carries an image at any depth (tool-result nesting included). */
export { contentHasImage } from '@deepseek-ai/dsh-llm';
/** Bounded promise cache for one attachment's description; failed reads are not retained. */
export declare class EvidenceCache {
    private readonly limit;
    private readonly entries;
    constructor(limit: number);
    /**
     * Read one key's entry or compute it. Concurrent readers join the in-flight
     * computation; a settled failure is evicted so a fixed configuration gets a
     * fresh chance.
     * @param key - the attachment identity (content-addressed).
     * @param load - computes the description; must resolve `{ ok, block }` and never reject.
     * @returns the cached or computed block.
     */
    read(key: string, load: () => Promise<{
        ok: boolean;
        block: ContentBlock;
    }>): Promise<ContentBlock>;
    /** Drop every cached description (runtime reconfiguration invalidates provider-specific reads). */
    clear(): void;
}
/**
 * Wait on a shared promise without inheriting its lifetime: the caller's
 * abort rejects this wait immediately, while the underlying read keeps
 * running and lands in the cache for the retry.
 * @param promise - the shared computation.
 * @param signal - the caller's cancellation, or undefined to wait unconditionally.
 * @returns the computed value, unless the caller aborted first.
 */
export declare function abortableWait<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T>;
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
export declare function convertImagesToEvidence(ctx: Context, runtime: () => VisionToolkitRuntime | undefined, cache: EvidenceCache, messages: readonly Message[], signal?: AbortSignal): Promise<Message[]>;
/**
 * The adapter behind one variant route: model metadata declares image input,
 * and every stream rewrites image blocks before delegating to the upstream
 * route through the host service (so the upstream route's own middleware,
 * retry policy, and replay handling still apply).
 */
export declare class ImageInputVariantAdapter extends LlmAdapter {
    private readonly ctx;
    private readonly llm;
    private readonly upstream;
    private readonly upstreamName;
    private readonly runtime;
    private readonly cache;
    private lastRuntime;
    constructor(ctx: Context, llm: LlmService, upstream: string, upstreamName: string, runtime: () => VisionToolkitRuntime | undefined, cache: EvidenceCache);
    providerInfo(provider: string): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncGenerator<StreamChunk>;
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
export declare function sessionPasteTakeover(ctx: Context, sessionId: string, modelLabel?: string): Promise<boolean>;
/**
 * Resolve the takeover verdict from the Session's last requested route header.
 * @param ctx - plugin context with `sessions` and `llm`.
 * @param sessionId - the live Session id.
 * @returns true when the persisted route is positively text-only.
 */
export declare function sessionHeaderTakeover(ctx: Context, sessionId: string): Promise<boolean>;
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
export declare function labelTakeoverVerdict(ctx: Context, label: string): Promise<boolean | undefined>;
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
export declare function createPasteTakeoverResolver(ctx: Context, getConfig: () => ResolvedVisionToolkitConfig): (sessionId: string, selection?: PasteSelectionQuery, modelLabel?: string) => Promise<PasteVerdict>;
/**
 * Register and maintain one variant route per eligible upstream route. Routes
 * that later vanish are released; routes that gain eligible models later are
 * picked up by the next sweep (host topology notifications included).
 * @param ctx - plugin context with the `llm` service.
 * @param getConfig - resolves the current plugin configuration per sweep.
 * @param getRuntime - the currently serving Vision Toolkit runtime, if ready.
 * @returns the disposer and a manual re-sweep trigger (settings changes).
 */
export declare function installImageInputVariants(ctx: Context, getConfig: () => ResolvedVisionToolkitConfig, getRuntime: () => VisionToolkitRuntime | undefined): {
    dispose: () => void;
    reconcile: () => void;
};
//# sourceMappingURL=image-input-variants.d.ts.map