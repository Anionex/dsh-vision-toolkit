/** Durable configured-storage history used to authorize persisted image paths after Profile restarts. */
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { type VisionToolkitConfig } from './config.ts';
/** Plugin-owned storage roots that survive Settings-provider and Profile restarts. */
export declare const storageHistoryDomainSpec: {
    name: string;
    version: number;
    global: {
        schema: z.ZodObject<{
            roots: z.ZodArray<z.ZodString>;
        }, z.core.$strip>;
        initial: {
            roots: never[];
        };
    };
    tables: {};
};
/**
 * Return every configured root that must remain readable, including the active root.
 * @param config - Settings generation to summarize.
 * @returns normalized configured roots in retention order.
 */
export declare function configuredStorageRoots(config: VisionToolkitConfig): string[];
/**
 * Merge plugin-owned roots into a Settings generation without retaining its active root as history.
 * @param config - Settings generation being restored.
 * @param durableRoots - roots loaded from the plugin-owned sidecar.
 * @returns the original generation when unchanged, otherwise a generation with restored history.
 */
export declare function restoreDurableStorageHistory(config: VisionToolkitConfig, durableRoots: readonly string[]): VisionToolkitConfig;
/** Optional storage-domain sidecar for storage roots that Settings cannot persist itself. */
export declare class StorageHistoryStore {
    private readonly ctx;
    private storage;
    private storageFiber;
    private storageReady;
    private mutationTail;
    private desiredRoots;
    private persistenceTicket;
    private warned;
    constructor(ctx: Context);
    /**
     * Restore durable roots into one Settings generation before runtime preparation.
     * @param config - Settings generation to restore.
     * @returns the generation with available durable roots merged into its history.
     */
    restore(config: VisionToolkitConfig): Promise<VisionToolkitConfig>;
    /**
     * Persist the active and historical configured roots.
     * @param config - validated generation whose roots must survive restart.
     * @returns false when no storage-domain is available; true after persistence or when there are no roots.
     */
    persist(config: VisionToolkitConfig): Promise<boolean>;
    /** Release the optional storage-domain binding with the plugin lifecycle. */
    dispose(): void;
    private prepareStorage;
    private activeStorage;
    private write;
    private enqueueMutation;
    private warnOnce;
}
//# sourceMappingURL=storage-history.d.ts.map