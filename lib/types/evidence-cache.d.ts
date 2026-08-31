/** Durable, Session-scoped cache for image descriptions used by model variants. */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ResolvedVisionToolkitConfig } from './config.ts';
/** Bump only when the model-visible evidence contract changes incompatibly. */
export declare const EVIDENCE_CONTRACT_VERSION = 1;
type EvidenceRecordKey = string & {
    readonly __evidenceRecordKey: unique symbol;
};
/** Plugin-owned sidecar domain; the host backend handles atomicity and file safety. */
export declare const evidenceCacheDomainSpec: {
    name: string;
    version: number;
    tables: {
        evidence: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<EvidenceRecordKey, string>;
    };
};
/** Stable metadata for one description lookup. Raw focus prompts are never persisted. */
export interface EvidenceCacheKey {
    readonly digest: string;
    readonly contractVersion: number;
    readonly sessionId?: string;
    readonly sessionCreatedAt?: number;
    readonly sessionCwd?: string;
    readonly attachmentId: string;
    readonly promptHash: string;
    readonly runtimeHash: string;
}
/** Optional durable layer behind the process-local promise/LRU cache. */
export interface EvidencePersistence {
    read(key: EvidenceCacheKey): Promise<ContentBlock | undefined>;
    write(key: EvidenceCacheKey, block: ContentBlock): Promise<void>;
}
/** Fingerprint every runtime setting that can change generated evidence or its embedded path. */
export declare function evidenceRuntimeFingerprint(config: ResolvedVisionToolkitConfig, credentialSha256?: string, sslVerify?: string): string;
/** Build a non-secret cache key from the Session, attachment, focus, and runtime contract. */
export declare function createEvidenceCacheKey(input: {
    sessionId?: string;
    sessionIdentity?: SessionIdentity;
    attachmentId: string;
    prompt: string;
    runtimeHash: string;
}): EvidenceCacheKey;
/** Bounded promise cache; concurrent readers join one load and rejected loads are evicted. */
export declare class EvidenceCache {
    private readonly limit;
    private readonly persistence?;
    private readonly entries;
    constructor(limit: number, persistence?: EvidencePersistence | undefined);
    /** Read a memory/durable hit or compute and persist one model-visible result. */
    read(key: string | EvidenceCacheKey, load: () => Promise<ContentBlock>): Promise<ContentBlock>;
    /** Drop process-local descriptions; durable rows stay versioned by their runtime fingerprint. */
    clear(): void;
}
interface SessionIdentity {
    createdAt: number;
    cwd?: string;
}
export interface SessionEvidenceStoreOptions {
    maxEntries?: number;
    maxBytes?: number;
    maxEntryBytes?: number;
    now?: () => number;
}
/** Official DSH storage-domain sidecar used to survive Profile restarts. */
export declare class SessionEvidenceStore implements EvidencePersistence {
    private readonly ctx;
    private storage;
    private storageFiber;
    private storageReady;
    private mutationTail;
    private readonly flushes;
    private warned;
    private readonly maxEntries;
    private readonly maxBytes;
    private readonly maxEntryBytes;
    private readonly now;
    constructor(ctx: Context, options?: SessionEvidenceStoreOptions);
    /** Release the optional storage binding with the owning variant lifecycle. */
    dispose(): void;
    read(key: EvidenceCacheKey): Promise<ContentBlock | undefined>;
    write(key: EvidenceCacheKey, block: ContentBlock): Promise<void>;
    private sessionFor;
    private prepareStorage;
    private enqueueMutation;
    private flushSession;
    private prune;
    private warnOnce;
}
export {};
//# sourceMappingURL=evidence-cache.d.ts.map