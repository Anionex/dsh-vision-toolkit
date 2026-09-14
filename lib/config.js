/**
 * Plugin configuration: provider endpoint and credential reference, output
 * language, limits, and the external upstream runtime location. Secrets never
 * live here — `provider.credential` is a DSH Credential reference resolved per
 * operation through `ctx.credentials`.
 * @module dsh-vision-toolkit/config
 */
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { VisionToolkitError } from "./errors.js";
import { BUILT_IN_FREE_VISION_BASE_URL, BUILT_IN_FREE_VISION_CREDENTIAL, BUILT_IN_FREE_VISION_MODEL, } from "./defaults.js";
export { BUILT_IN_FREE_VISION_BASE_URL, BUILT_IN_FREE_VISION_CREDENTIAL, BUILT_IN_FREE_VISION_KEY, BUILT_IN_FREE_VISION_MODEL, } from "./defaults.js";
/**
 * The namespace pattern the removed `settingsNamespace` helper enforced.
 * dsh 0.1.2-alpha dropped that export; importing a missing named export is a
 * module-evaluation error that stops the host from booting, so the check is
 * inlined here instead of imported. The namespace is a static string, so no
 * runtime dependency on `@deepseek-ai/dsh-settings` is needed.
 */
const SETTINGS_NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/** Settings document namespace owned by this plugin. */
export const VISION_TOOLKIT_SETTINGS_NAMESPACE = 'vision-toolkit';
if (!SETTINGS_NAMESPACE_PATTERN.test(VISION_TOOLKIT_SETTINGS_NAMESPACE)) {
    throw new TypeError(`settings namespace "${VISION_TOOLKIT_SETTINGS_NAMESPACE}" must match ${String(SETTINGS_NAMESPACE_PATTERN)}`);
}
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
        headers: z.dict(z.string()).default({}),
        sessionHeaders: z.array(z.string()).default([]),
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
    storageDir: z.string(),
    storageHistory: z.array(z.string()).default([]),
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
const MAX_PROVIDER_HEADER_COUNT = 32;
const MAX_PROVIDER_HEADER_NAME_BYTES = 128;
const MAX_PROVIDER_HEADER_VALUE_BYTES = 4096;
const MAX_PROVIDER_HEADER_BYTES = 16 * 1024;
/** Headers owned by the client or HTTP transport cannot be taken over by configuration. */
const RESERVED_PROVIDER_HEADER_NAMES = new Set([
    'authorization',
    'connection',
    'content-length',
    'content-type',
    'cookie',
    'expect',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'proxy-connection',
    'set-cookie',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'user-agent',
    'www-authenticate',
    'x-api-key',
    'anthropic-version',
]);
function headerBytes(value) {
    return Buffer.byteLength(value, 'utf8');
}
/** Validate one header without echoing its potentially sensitive value. */
function assertSendableHeader(field, name, value) {
    if (headerBytes(name) > MAX_PROVIDER_HEADER_NAME_BYTES) {
        throw new VisionToolkitError('config', `${field} entry "${name}" exceeds the ${MAX_PROVIDER_HEADER_NAME_BYTES}-byte name limit`);
    }
    if (headerBytes(value) > MAX_PROVIDER_HEADER_VALUE_BYTES) {
        throw new VisionToolkitError('config', `${field} entry "${name}" exceeds the ${MAX_PROVIDER_HEADER_VALUE_BYTES}-byte value limit`);
    }
    try {
        new Headers([[name, value]]);
    }
    catch {
        throw new VisionToolkitError('config', `${field} entry "${name}" is not a valid HTTP header; use a valid field name and a single-line value`);
    }
}
function normalizeProviderHeaders(provider) {
    const normalized = new Map();
    for (const [rawName, value] of Object.entries(provider.headers ?? {})) {
        const name = rawName.trim().toLowerCase();
        if (name.length === 0)
            throw new VisionToolkitError('config', 'provider.headers has an entry with an empty name');
        if (RESERVED_PROVIDER_HEADER_NAMES.has(name)) {
            throw new VisionToolkitError('config', `provider.headers must not set "${name}"; the client or HTTP transport owns it`);
        }
        if (normalized.has(name)) {
            throw new VisionToolkitError('config', `provider.headers contains the duplicate name "${name}"`);
        }
        assertSendableHeader('provider.headers', name, value);
        normalized.set(name, value);
    }
    const sessions = new Set();
    for (const rawName of provider.sessionHeaders ?? []) {
        const name = rawName.trim().toLowerCase();
        if (name.length === 0)
            throw new VisionToolkitError('config', 'provider.sessionHeaders has an empty entry');
        if (RESERVED_PROVIDER_HEADER_NAMES.has(name)) {
            throw new VisionToolkitError('config', `provider.sessionHeaders must not name "${name}"; the client or HTTP transport owns it`);
        }
        if (sessions.has(name)) {
            throw new VisionToolkitError('config', `provider.sessionHeaders contains the duplicate name "${name}"`);
        }
        if (normalized.has(name)) {
            throw new VisionToolkitError('config', `provider.headers and provider.sessionHeaders both name "${name}"`);
        }
        assertSendableHeader('provider.sessionHeaders', name, '0'.repeat(32));
        sessions.add(name);
    }
    if (normalized.size + sessions.size > MAX_PROVIDER_HEADER_COUNT) {
        throw new VisionToolkitError('config', `provider headers must contain at most ${MAX_PROVIDER_HEADER_COUNT} entries in total`);
    }
    const compareNames = (left, right) => left < right ? -1 : left > right ? 1 : 0;
    const entries = [...normalized.entries()].sort(([left], [right]) => compareNames(left, right));
    const sessionHeaders = [...sessions].sort(compareNames);
    const totalBytes = entries.reduce((total, [name, value]) => total + headerBytes(name) + headerBytes(value) + 4, 0)
        + sessionHeaders.reduce((total, name) => total + headerBytes(name) + 32 + 4, 0);
    if (totalBytes > MAX_PROVIDER_HEADER_BYTES) {
        throw new VisionToolkitError('config', `provider headers exceed the ${MAX_PROVIDER_HEADER_BYTES}-byte total limit`);
    }
    return { headers: Object.fromEntries(entries), sessionHeaders };
}
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
    const { headers, sessionHeaders } = normalizeProviderHeaders(provider);
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
    const storageDir = config.storageDir?.trim();
    const storageHistory = [...new Set((config.storageHistory ?? [])
            .map(dir => dir.trim())
            .filter(dir => dir.length > 0 && dir !== storageDir))];
    const allowedDirs = (config.allowedDirs ?? []).map(dir => dir.trim()).filter(dir => dir.length > 0);
    const imageInputVariants = config.imageInputVariants ?? {};
    const variantProviders = (imageInputVariants.providers ?? [])
        .map(provider => provider.trim())
        .filter(provider => provider.length > 0);
    return {
        provider: { baseUrl, credential, model, protocol, anthropicThinking, userAgent, headers, sessionHeaders },
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
        ...(storageDir === undefined || storageDir.length === 0 ? {} : { storageDir }),
        storageHistory,
        allowedDirs,
        imageInputVariants: {
            enabled: imageInputVariants.enabled ?? true,
            providers: variantProviders,
            autoSwitch: imageInputVariants.autoSwitch ?? true,
            hidden: imageInputVariants.hidden ?? true,
        },
    };
}
/** Merge prior storage roots into the next resolved generation's read-only history. */
export function retainedStorageHistory(next, previous) {
    const resolvedNext = resolveConfig(next);
    const resolvedPrevious = resolveConfig(previous);
    return [...new Set([
            ...resolvedPrevious.storageHistory,
            ...resolvedNext.storageHistory,
            ...(resolvedPrevious.storageDir === undefined ? [] : [resolvedPrevious.storageDir]),
        ])].filter(storageDir => storageDir !== resolvedNext.storageDir);
}
/** Prepare one live Settings generation without letting internal history writeback block activation. */
export async function prepareWatchedSettingsGeneration(next, previous, writable, persistStorageHistory) {
    const storageHistory = retainedStorageHistory(next, previous);
    if (JSON.stringify(storageHistory) === JSON.stringify(resolveConfig(next).storageHistory))
        return { config: next };
    const config = { ...next, storageHistory };
    if (!writable)
        return { config, requiresDurableStorageHistory: true };
    try {
        await persistStorageHistory(storageHistory);
        return {};
    }
    catch (persistenceError) {
        return { config, requiresDurableStorageHistory: true, persistenceError };
    }
}
/** Whether a resolved provider should use the bundled public key instead of DSH credentials. */
export function isBuiltInFreeVisionProvider(provider) {
    return String(provider.credential) === BUILT_IN_FREE_VISION_CREDENTIAL
        && provider.baseUrl === BUILT_IN_FREE_VISION_BASE_URL
        && BUILT_IN_FREE_VISION_MODEL_ALIASES.has(provider.model)
        && provider.protocol === 'openai';
}
//# sourceMappingURL=config.js.map