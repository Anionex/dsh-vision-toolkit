/**
 * Plugin configuration: provider endpoint and credential reference, output
 * language, limits, and the external upstream runtime location. Secrets never
 * live here — `provider.credential` is a DSH Credential reference resolved per
 * operation through `ctx.credentials`.
 * @module dsh-vision-toolkit/config
 */
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { VisionToolkitError } from "./errors.js";
import { BUILT_IN_FREE_VISION_BASE_URL, BUILT_IN_FREE_VISION_CREDENTIAL, BUILT_IN_FREE_VISION_MODEL, } from "./defaults.js";
export { BUILT_IN_FREE_VISION_BASE_URL, BUILT_IN_FREE_VISION_CREDENTIAL, BUILT_IN_FREE_VISION_KEY, BUILT_IN_FREE_VISION_MODEL, } from "./defaults.js";
/** Settings document namespace owned by this plugin. */
export const VISION_TOOLKIT_SETTINGS_NAMESPACE = settingsNamespace('vision-toolkit');
/** Browser-compatible default shared with the vendored Python client. */
export const DEFAULT_VISION_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BUILT_IN_FREE_VISION_MODEL_ALIASES = new Set([
    BUILT_IN_FREE_VISION_MODEL,
    'gemini-3.7-flash',
    'qwen/qwen3.6-27b',
    'qwen3.6-27b',
    'gemma-4-26b-a4b-it',
    'gemma-4-26b',
    '@cf/google/gemma-4-26b-a4b-it',
    '@cf/moondream/moondream3.1-9B-A2B',
    'moondream',
    'moondream-3.1',
    'moondream3.1-9B-A2B',
]);
/** Configuration schema with the documented P0 defaults. */
export const Config = z.object({
    provider: z.object({
        baseUrl: z.string().default(BUILT_IN_FREE_VISION_BASE_URL),
        credential: z.string().default(BUILT_IN_FREE_VISION_CREDENTIAL),
        model: z.string().default(BUILT_IN_FREE_VISION_MODEL),
        protocol: z.union(['openai', 'anthropic']).default('openai'),
        anthropicThinking: z.union(['omit', 'disabled', 'adaptive']).default('omit'),
        userAgent: z.string().default(DEFAULT_VISION_USER_AGENT),
    }),
    language: z.union(['zh', 'en']).default('zh'),
    timeoutMs: z.number().default(30000),
    maxImageBytes: z.number().default(4194304),
    maxImagePixels: z.number().default(20000000),
    concurrency: z.number().default(4),
    runtime: z.object({
        mode: z.union(['managed', 'external']).default('managed'),
        agentVisionToolkitPath: z.string(),
        python: z.string(),
    }),
    allowedDirs: z.array(z.string()).default([]),
    imageInputVariants: z.object({
        enabled: z.boolean().default(true),
        providers: z.array(z.string()).default([]),
        autoSwitch: z.boolean().default(true),
        hidden: z.boolean().default(true),
    }),
});
const MAX_TIMEOUT_MS = 600000;
const MAX_IMAGE_BYTES = 268435456;
const MAX_IMAGE_PIXELS = 268435456;
const MAX_CONCURRENCY = 16;
/**
 * Validate and normalize a config object (partial inputs receive the same
 * defaults the schemastery schema applies). Configuration mistakes fail loud
 * at plugin load (the earliest resolvable point); runtime availability is a
 * separate, later concern.
 * @param config - parsed config with defaults applied.
 * @returns the fully defaulted, validated configuration.
 */
export function resolveConfig(config = {}) {
    const provider = config.provider ?? {};
    const runtime = config.runtime ?? {};
    const baseUrl = (provider.baseUrl ?? BUILT_IN_FREE_VISION_BASE_URL).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl) || baseUrl.length <= 'https://'.length) {
        throw new VisionToolkitError('config', 'provider.baseUrl must be an http(s) URL');
    }
    let credential;
    try {
        credential = credentialRef((provider.credential ?? BUILT_IN_FREE_VISION_CREDENTIAL).trim());
    }
    catch (error) {
        throw new VisionToolkitError('config', `provider.credential "${provider.credential ?? BUILT_IN_FREE_VISION_CREDENTIAL}" is not a valid credential reference`, { cause: error });
    }
    const model = (provider.model ?? BUILT_IN_FREE_VISION_MODEL).trim();
    if (model.length === 0) {
        throw new VisionToolkitError('config', 'provider.model must not be empty');
    }
    const protocol = provider.protocol ?? 'openai';
    if (protocol !== 'openai' && protocol !== 'anthropic') {
        throw new VisionToolkitError('config', 'provider.protocol must be "openai" or "anthropic"');
    }
    const anthropicThinking = provider.anthropicThinking ?? 'omit';
    if (anthropicThinking !== 'omit' && anthropicThinking !== 'disabled' && anthropicThinking !== 'adaptive') {
        throw new VisionToolkitError('config', 'provider.anthropicThinking must be "omit", "disabled", or "adaptive"');
    }
    const userAgent = (provider.userAgent ?? DEFAULT_VISION_USER_AGENT).trim();
    if (userAgent.length === 0) {
        throw new VisionToolkitError('config', 'provider.userAgent must not be empty');
    }
    const language = config.language ?? 'zh';
    if (language !== 'zh' && language !== 'en') {
        throw new VisionToolkitError('config', 'language must be "zh" or "en"');
    }
    const timeoutMs = config.timeoutMs ?? 30000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new VisionToolkitError('config', `timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}`);
    }
    const maxImageBytes = config.maxImageBytes ?? 4194304;
    if (!Number.isInteger(maxImageBytes) || maxImageBytes < 1024 || maxImageBytes > MAX_IMAGE_BYTES) {
        throw new VisionToolkitError('config', `maxImageBytes must be an integer between 1024 and ${MAX_IMAGE_BYTES}`);
    }
    const maxImagePixels = config.maxImagePixels ?? 20000000;
    if (!Number.isInteger(maxImagePixels) || maxImagePixels < 1 || maxImagePixels > MAX_IMAGE_PIXELS) {
        throw new VisionToolkitError('config', `maxImagePixels must be an integer between 1 and ${MAX_IMAGE_PIXELS}`);
    }
    const concurrency = config.concurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
        throw new VisionToolkitError('config', `concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
    }
    const mode = runtime.mode ?? 'managed';
    if (mode !== 'managed' && mode !== 'external') {
        throw new VisionToolkitError('config', 'runtime.mode must be "managed" or "external"');
    }
    const toolkitPath = runtime.agentVisionToolkitPath?.trim();
    if (toolkitPath !== undefined && toolkitPath.length === 0) {
        throw new VisionToolkitError('config', 'runtime.agentVisionToolkitPath must not be empty when provided');
    }
    if (mode === 'external' && toolkitPath === undefined) {
        throw new VisionToolkitError('config', 'runtime.agentVisionToolkitPath is required when runtime.mode is external');
    }
    if (mode === 'managed' && toolkitPath !== undefined) {
        throw new VisionToolkitError('config', 'runtime.agentVisionToolkitPath is only valid when runtime.mode is external');
    }
    const python = runtime.python?.trim();
    if (python !== undefined && python.length === 0) {
        throw new VisionToolkitError('config', 'runtime.python must not be empty');
    }
    const allowedDirs = (config.allowedDirs ?? []).map(dir => dir.trim()).filter(dir => dir.length > 0);
    const imageInputVariants = config.imageInputVariants ?? {};
    const variantProviders = (imageInputVariants.providers ?? [])
        .map(provider => provider.trim())
        .filter(provider => provider.length > 0);
    return {
        provider: { baseUrl, credential, model, protocol, anthropicThinking, userAgent },
        language,
        timeoutMs,
        maxImageBytes,
        maxImagePixels,
        concurrency,
        runtime: {
            mode,
            ...(toolkitPath !== undefined ? { agentVisionToolkitPath: toolkitPath } : {}),
            ...(python !== undefined ? { python } : {}),
        },
        allowedDirs,
        imageInputVariants: {
            enabled: imageInputVariants.enabled ?? true,
            providers: variantProviders,
            autoSwitch: imageInputVariants.autoSwitch ?? true,
            hidden: imageInputVariants.hidden ?? true,
        },
    };
}
/** Whether a resolved provider should use the bundled public key instead of DSH credentials. */
export function isBuiltInFreeVisionProvider(provider) {
    return String(provider.credential) === BUILT_IN_FREE_VISION_CREDENTIAL
        && provider.baseUrl === BUILT_IN_FREE_VISION_BASE_URL
        && BUILT_IN_FREE_VISION_MODEL_ALIASES.has(provider.model)
        && provider.protocol === 'openai';
}
//# sourceMappingURL=config.js.map