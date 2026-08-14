/**
 * Plugin configuration: provider endpoint and credential reference, output
 * language, limits, and the external upstream runtime location. Secrets never
 * live here — `provider.credential` is a DSH Credential reference resolved per
 * operation through `ctx.credentials`.
 * @module dsh-vision-toolkit/config
 */
import type Schema from '@deepseek-ai/schemastery';
import { type CredentialRef } from '@deepseek-ai/dsh-credentials';
/** Settings document namespace owned by this plugin. */
export declare const VISION_TOOLKIT_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
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
    /** Maximum decoded pixel count per input image. */
    maxImagePixels?: number;
    /** In-flight tool execution cap per session. */
    concurrency?: number;
    runtime?: {
        /** `managed` uses the packaged snapshot and isolated venv; `external` uses a clean pinned checkout. */
        mode?: 'managed' | 'external';
        /** Required path to the clean pinned checkout when `mode` is `external`. */
        agentVisionToolkitPath?: string;
        /** Optional Python 3.11+ bootstrap/interpreter override. */
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
    maxImagePixels: number;
    concurrency: number;
    runtime: {
        mode: 'managed' | 'external';
        agentVisionToolkitPath?: string;
        python?: string;
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