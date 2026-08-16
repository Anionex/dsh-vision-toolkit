/**
 * Plugin configuration: provider endpoint and credential reference, output
 * language, limits, and the external upstream runtime location. Secrets never
 * live here — `provider.credential` is a DSH Credential reference resolved per
 * operation through `ctx.credentials`.
 * @module dsh-vision-toolkit/config
 */
import type Schema from '@deepseek-ai/schemastery';
import { type CredentialRef } from '@deepseek-ai/dsh-credentials';
export { BUILT_IN_FREE_VISION_BASE_URL, BUILT_IN_FREE_VISION_CREDENTIAL, BUILT_IN_FREE_VISION_MODEL, } from './defaults.ts';
/** Settings document namespace owned by this plugin. */
export declare const VISION_TOOLKIT_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Browser-compatible default shared with the vendored Python client. */
export declare const DEFAULT_VISION_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
/** Full user-facing configuration; every field defaults at the schema boundary. */
export interface VisionToolkitConfig {
    provider?: {
        /** Provider API base URL. */
        baseUrl?: string;
        /** DSH Credential reference holding the API key (an environment-style name). */
        credential?: string;
        /** Multimodal model name. */
        model?: string;
        /** Vision request protocol: OpenAI Chat Completions or Anthropic Messages. */
        protocol?: 'openai' | 'anthropic';
        /** Anthropic thinking field behavior; `omit` leaves model defaults untouched. */
        anthropicThinking?: 'omit' | 'disabled' | 'adaptive';
        /** Outbound User-Agent for provider requests and connection tests. */
        userAgent?: string;
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
    /**
     * Image-input variants: sibling model-selector entries for every model the
     * host positively declares text-only. A variant declares image input, so
     * pasted images keep the native attachment flow (composer thumbnail and
     * durable session image), and the plugin rewrites image blocks into Vision
     * Toolkit descriptions only on the wire to the model.
     */
    imageInputVariants?: {
        /** Whether variant routes are registered at all (default true). */
        enabled?: boolean;
        /** Restrict wrapped upstream routes by provider id; empty wraps every eligible route. */
        providers?: string[];
        /**
         * Whether the browser paste integration automatically switches the Session
         * to the image-input variant of a text-only model before the paste, so
         * pasted images keep the native attachment flow with no manual model
         * change. Off means a text-only model keeps the path takeover (default
         * true).
         */
        autoSwitch?: boolean;
    };
}
/** Configuration schema with the documented P0 defaults. */
export declare const Config: Schema<VisionToolkitConfig>;
/** Configuration after static validation, with every default materialized. */
export interface ResolvedVisionToolkitConfig {
    provider: {
        baseUrl: string;
        credential: CredentialRef;
        model: string;
        protocol: 'openai' | 'anthropic';
        anthropicThinking: 'omit' | 'disabled' | 'adaptive';
        userAgent: string;
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
    imageInputVariants: {
        enabled: boolean;
        providers: string[];
        autoSwitch: boolean;
    };
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
/** Whether a resolved provider should use the bundled public key instead of DSH credentials. */
export declare function isBuiltInFreeVisionProvider(provider: ResolvedVisionToolkitConfig['provider']): boolean;
//# sourceMappingURL=config.d.ts.map