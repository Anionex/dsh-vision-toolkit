/**
 * Plugin configuration: provider endpoint and credential reference, output
 * language, limits, and the external upstream runtime location. Secrets never
 * live here — `provider.credential` is a DSH Credential reference resolved per
 * operation through `ctx.credentials`.
 * @module dsh-vision-toolkit/config
 */
import z from 'schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { VisionToolkitError } from "./errors.js";
/** Configuration schema with the documented P0 defaults. */
export const Config = z.object({
    provider: z.object({
        baseUrl: z.string().default('https://api.inferera.com/v1'),
        credential: z.string().default('VISION_API_KEY'),
        model: z.string().default('gemini-3.6-flash'),
    }),
    language: z.union(['zh', 'en']).default('zh'),
    timeoutMs: z.number().default(60000),
    maxImageBytes: z.number().default(10485760),
    maxImagePixels: z.number().default(40000000),
    concurrency: z.number().default(4),
    runtime: z.object({
        mode: z.union(['managed', 'external']).default('managed'),
        agentVisionToolkitPath: z.string(),
        python: z.string(),
    }),
    allowedDirs: z.array(z.string()).default([]),
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
    const baseUrl = (provider.baseUrl ?? 'https://api.inferera.com/v1').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl) || baseUrl.length <= 'https://'.length) {
        throw new VisionToolkitError('config', 'provider.baseUrl must be an http(s) URL');
    }
    let credential;
    try {
        credential = credentialRef((provider.credential ?? 'VISION_API_KEY').trim());
    }
    catch (error) {
        throw new VisionToolkitError('config', `provider.credential "${provider.credential ?? 'VISION_API_KEY'}" is not a valid credential reference`, { cause: error });
    }
    const model = (provider.model ?? 'gemini-3.6-flash').trim();
    if (model.length === 0) {
        throw new VisionToolkitError('config', 'provider.model must not be empty');
    }
    const language = config.language ?? 'zh';
    if (language !== 'zh' && language !== 'en') {
        throw new VisionToolkitError('config', 'language must be "zh" or "en"');
    }
    const timeoutMs = config.timeoutMs ?? 60000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new VisionToolkitError('config', `timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}`);
    }
    const maxImageBytes = config.maxImageBytes ?? 10485760;
    if (!Number.isInteger(maxImageBytes) || maxImageBytes < 1024 || maxImageBytes > MAX_IMAGE_BYTES) {
        throw new VisionToolkitError('config', `maxImageBytes must be an integer between 1024 and ${MAX_IMAGE_BYTES}`);
    }
    const maxImagePixels = config.maxImagePixels ?? 40000000;
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
    return {
        provider: { baseUrl, credential, model },
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
    };
}
//# sourceMappingURL=config.js.map