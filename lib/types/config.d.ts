/**
 * Plugin configuration: provider endpoint and credential reference, output
 * language, limits, and the external upstream runtime location. Secrets never
 * live here — `provider.credential` is a DSH Credential reference resolved per
 * operation through `ctx.credentials`.
 * @module dsh-vision-toolkit/config
 */
import type Schema from 'schemastery';
import { type CredentialRef } from '@deepseek-ai/dsh-credentials';
/** Full user-facing configuration; every field defaults at the schema boundary. */
export interface VisionToolkitConfig {
    provider?: {
        /** OpenAI-compatible chat/completions base URL. */
        baseUrl?: string;
        /** DSH Credential reference holding the API key (an environment-style name). */
        credential?: string;
        /** Multimodal model name. */
        model?: string;
    };
    /** Vision output language (`zh` or `en`). */
    language?: 'zh' | 'en';
    /** Single remote/upstream call budget in milliseconds. */
    timeoutMs?: number;
    /** Maximum accepted input image size in bytes. */
    maxImageBytes?: number;
    /** In-flight tool execution cap per session. */
    concurrency?: number;
    runtime?: {
        /** `external` uses an installed agent-vision-toolkit checkout; managed runtime preparation is planned for P1. */
        mode?: 'external';
        /** Path to the upstream checkout. Defaults to `AGENT_VISION_TOOLKIT_PATH`, then conventional locations. */
        agentVisionToolkitPath?: string;
        /** Python executable used to launch upstream CLIs. */
        python?: string;
    };
    /** Extra directories (besides the workspace) inputs may come from. */
    allowedDirs?: string[];
}
/** Configuration schema with the documented P0 defaults. */
export declare const Config: Schema<VisionToolkitConfig>;
/** Configuration after static validation, with every default materialized. */
export interface ResolvedVisionToolkitConfig {
    provider: {
        baseUrl: string;
        credential: CredentialRef;
        model: string;
    };
    language: 'zh' | 'en';
    timeoutMs: number;
    maxImageBytes: number;
    concurrency: number;
    runtime: {
        mode: 'external';
        agentVisionToolkitPath?: string;
        python: string;
    };
    allowedDirs: string[];
}
/**
 * Validate and normalize a config object (partial inputs receive the same
 * defaults the schemastery schema applies). Configuration mistakes fail loud
 * at plugin load (the earliest resolvable point); runtime availability is a
 * separate, later concern.
 * @param config - parsed config with defaults applied.
 * @returns the fully defaulted, validated configuration.
 */
export declare function resolveConfig(config?: VisionToolkitConfig): ResolvedVisionToolkitConfig;
//# sourceMappingURL=config.d.ts.map