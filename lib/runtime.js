/**
 * Vision Toolkit runtime: structured requests in, structured results out.
 * One operation-wide deadline reaches every subprocess; image decoding,
 * byte/pixel limits, session-scoped concurrency, credential resolution, safe
 * output staging, and diagnostic logging stay below the model-facing tools.
 * @module dsh-vision-toolkit/runtime
 */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SaxesParser } from 'saxes';
import { describeArtifact } from "./artifacts.js";
import { isBuiltInFreeVisionProvider } from "./config.js";
import { BUILT_IN_FREE_VISION_KEY } from "./defaults.js";
import { VisionToolkitError } from "./errors.js";
import { assertDistinctOutput, commitStagedDirectory, commitStagedOutput, createPathPolicy, createStagedDirectory, createStagedOutput, isWithin, resolveHtmlFile, resolveInputFile, resolveOutputDirectory, resolveOutputFile, seedStagedDirectory, } from "./paths.js";
import { parseCropOutput, parseDominantColorsOutput, parseExtractForegroundOutput, parseHtmlScreenshotOutput, parseLocationOutput, parsePixelDiffOutput, parseTraceOutput, UpstreamAdapter, } from "./upstream.js";
import { PLUGIN_VERSION } from "./version.js";
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const VISION_MODEL_TEST_IMAGE = fileURLToPath(new URL('../assets/vision-model-test.png', import.meta.url));
const VISION_MODEL_TEST_PROMPT = 'This is an explicit service readiness test. Reply with one short sentence confirming that you received the image.';
/** Bump when the Pillow compression ladder changes so stale cache entries are ignored. */
const COMPRESSED_IMAGE_CACHE_VERSION = 'v2';
/** Cache keys carry 64-bit digests so Windows paths stay below MAX_PATH; the full file sha256 is computed on read and compared against this prefix. */
const COMPRESSED_IMAGE_CACHE_KEY_DIGEST_LENGTH = 16;
const COMPRESSED_IMAGE_CACHE_MAX_ENTRIES = 200;
const COMPRESSED_IMAGE_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const COMPRESSED_IMAGE_CACHE_STALE_PARTIAL_MS = 60 * 60 * 1000;
function svgDocumentPathCount(svg) {
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0;
    let invalid = false;
    let pathCount = 0;
    let rootSeen = false;
    let rootClosed = false;
    parser.on('doctype', () => { invalid = true; });
    parser.on('error', () => { invalid = true; });
    parser.on('opentag', (tag) => {
        if (depth === 0) {
            if (rootSeen || tag.local !== 'svg' || tag.uri !== SVG_NAMESPACE)
                invalid = true;
            rootSeen = true;
        }
        if (tag.local === 'path' && tag.uri === SVG_NAMESPACE)
            pathCount += 1;
        depth += 1;
    });
    parser.on('closetag', () => {
        depth -= 1;
        if (depth === 0)
            rootClosed = true;
        if (depth < 0)
            invalid = true;
    });
    try {
        parser.write(svg).close();
    }
    catch {
        return undefined;
    }
    return invalid || !rootSeen || !rootClosed || depth !== 0 ? undefined : pathCount;
}
/** Combine a caller abort signal with one hard operation timeout. */
export function createDeadline(signal, timeoutMs) {
    const controller = new AbortController();
    const state = { timedOut: false, cancelled: false };
    const onCallerAbort = () => {
        if (controller.signal.aborted)
            return;
        state.cancelled = true;
        controller.abort();
    };
    if (signal.aborted) {
        state.cancelled = true;
        controller.abort();
    }
    else {
        signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const timer = setTimeout(() => {
        if (controller.signal.aborted)
            return;
        state.timedOut = true;
        controller.abort();
    }, timeoutMs);
    return {
        signal: controller.signal,
        get timedOut() { return state.timedOut; },
        get cancelled() { return state.cancelled; },
        cleanup() {
            clearTimeout(timer);
            signal.removeEventListener('abort', onCallerAbort);
        },
    };
}
/** FIFO bounded concurrency gate whose queued callers remain cancellable. */
export class Semaphore {
    limit;
    active = 0;
    waiters = [];
    constructor(limit) {
        this.limit = limit;
    }
    /** Whether no active or queued caller still owns this gate. */
    get idle() {
        return this.active === 0 && this.waiters.length === 0;
    }
    /** Acquire one slot, aborting while queued when `signal` fires. */
    async acquire(signal, permits = 1) {
        if (signal.aborted)
            throw new VisionToolkitError('cancelled', 'vision-toolkit: cancelled before execution');
        if (!Number.isInteger(permits) || permits < 1 || permits > this.limit) {
            throw new VisionToolkitError('input', `concurrency permits must be between 1 and ${this.limit}`);
        }
        if (this.waiters.length === 0 && this.active + permits <= this.limit) {
            this.active += permits;
            return;
        }
        return new Promise((resolveAcquire, reject) => {
            const entry = {
                resolve: resolveAcquire,
                reject,
                signal,
                permits,
                onAbort: () => { },
            };
            entry.onAbort = () => {
                const index = this.waiters.indexOf(entry);
                if (index >= 0)
                    this.waiters.splice(index, 1);
                reject(new VisionToolkitError('cancelled', 'vision-toolkit: cancelled while waiting for a concurrency slot'));
            };
            this.waiters.push(entry);
            signal.addEventListener('abort', entry.onAbort, { once: true });
        });
    }
    /** Release owned permits and wake FIFO waiters whose full weight now fits. */
    release(permits = 1) {
        this.active = Math.max(0, this.active - permits);
        while (this.waiters.length > 0) {
            const next = this.waiters[0];
            if (next === undefined || this.active + next.permits > this.limit)
                break;
            this.waiters.shift();
            next.signal.removeEventListener('abort', next.onAbort);
            this.active += next.permits;
            next.resolve();
        }
    }
}
const REGION_PATTERN = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*$/;
const MAX_TIMEOUT_MS = 600_000;
const FORMAT_BY_EXTENSION = new Map([
    ['.png', 'png'],
    ['.jpg', 'jpeg'],
    ['.jpeg', 'jpeg'],
    ['.gif', 'gif'],
    ['.webp', 'webp'],
]);
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
function integerInRange(value, fallback, minimum, maximum, name) {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
        throw new VisionToolkitError('input', `${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return resolved;
}
function finiteInRange(value, minimum, maximum, name) {
    if (value === undefined)
        return undefined;
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new VisionToolkitError('input', `${name} must be between ${minimum} and ${maximum}`);
    }
    return value;
}
function assertBoxWithin(box, width, height, source) {
    if (![box.x1, box.y1, box.x2, box.y2].every(Number.isInteger)
        || box.x1 < 0
        || box.y1 < 0
        || box.x2 <= box.x1
        || box.y2 <= box.y1
        || box.x2 > width
        || box.y2 > height) {
        throw new VisionToolkitError('output', `${source} returned an out-of-range box for ${width}x${height}`);
    }
}
function safeGeneratedName(name, source) {
    if (typeof name !== 'string' || name.length === 0 || basename(name) !== name || name === '.' || name === '..') {
        throw new VisionToolkitError('output', `${source} returned an unsafe generated filename`);
    }
    return name;
}
function objectRecord(value, source) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new VisionToolkitError('output', `${source} must be a JSON object`);
    }
    return value;
}
function manifestInteger(record, key, source) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new VisionToolkitError('output', `${source}.${key} must be an integer`);
    }
    return value;
}
function parseLongOcrManifest(text, expected) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (error) {
        throw new VisionToolkitError('output', 'long_screenshot_ocr: manifest is not valid JSON', { cause: error });
    }
    const manifest = objectRecord(parsed, 'long_screenshot_ocr manifest');
    if (manifest.schema_version !== 1)
        throw new VisionToolkitError('output', 'long_screenshot_ocr: unsupported manifest schema');
    if (manifest.input !== expected.source)
        throw new VisionToolkitError('output', 'long_screenshot_ocr: manifest source does not match the requested image');
    if (manifestInteger(manifest, 'image_width', 'long_screenshot_ocr manifest') !== expected.width
        || manifestInteger(manifest, 'image_height', 'long_screenshot_ocr manifest') !== expected.height) {
        throw new VisionToolkitError('output', 'long_screenshot_ocr: manifest dimensions do not match the source image');
    }
    if (manifest.mode !== expected.mode)
        throw new VisionToolkitError('output', 'long_screenshot_ocr: manifest mode does not match the request');
    const complete = manifest.complete;
    if (typeof complete !== 'boolean' || complete === expected.splitOnly) {
        throw new VisionToolkitError('output', 'long_screenshot_ocr: manifest completion state is inconsistent');
    }
    if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
        throw new VisionToolkitError('output', 'long_screenshot_ocr: manifest contains no chunks');
    }
    if (manifest.output !== (expected.splitOnly ? null : expected.output)) {
        throw new VisionToolkitError('output', 'long_screenshot_ocr: manifest output path is inconsistent');
    }
    const chunks = manifest.chunks.map((value, position) => {
        const record = objectRecord(value, `long_screenshot_ocr manifest.chunks[${position}]`);
        const index = manifestInteger(record, 'index', `long_screenshot_ocr manifest.chunks[${position}]`);
        if (index !== position + 1)
            throw new VisionToolkitError('output', 'long_screenshot_ocr: chunk indexes are not contiguous');
        const image = safeGeneratedName(record.image, 'long_screenshot_ocr');
        const imageSha256 = record.image_sha256;
        if (typeof imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(imageSha256)) {
            throw new VisionToolkitError('output', 'long_screenshot_ocr: chunk image hash is invalid');
        }
        const coreTop = manifestInteger(record, 'core_top', `long_screenshot_ocr manifest.chunks[${position}]`);
        const coreBottom = manifestInteger(record, 'core_bottom', `long_screenshot_ocr manifest.chunks[${position}]`);
        const cropTop = manifestInteger(record, 'crop_top', `long_screenshot_ocr manifest.chunks[${position}]`);
        const cropBottom = manifestInteger(record, 'crop_bottom', `long_screenshot_ocr manifest.chunks[${position}]`);
        if (coreTop < 0
            || coreBottom <= coreTop
            || cropTop < 0
            || cropBottom <= cropTop
            || cropTop > coreTop
            || cropBottom < coreBottom
            || cropBottom > expected.height) {
            throw new VisionToolkitError('output', 'long_screenshot_ocr: manifest contains an invalid chunk range');
        }
        const ocr = record.ocr === undefined ? undefined : safeGeneratedName(record.ocr, 'long_screenshot_ocr');
        const ocrReused = record.ocr_reused;
        if (ocrReused !== undefined && typeof ocrReused !== 'boolean') {
            throw new VisionToolkitError('output', 'long_screenshot_ocr: ocr_reused must be boolean');
        }
        if (complete && ocr === undefined)
            throw new VisionToolkitError('output', 'long_screenshot_ocr: complete manifest is missing an OCR sidecar');
        return {
            index,
            image,
            imageSha256,
            coreTop,
            coreBottom,
            cropTop,
            cropBottom,
            ...(ocr === undefined ? {} : { ocr }),
            ...(ocrReused === undefined ? {} : { ocrReused }),
        };
    });
    return { mode: expected.mode, complete, chunks, raw: manifest };
}
/** Parse a non-empty four-integer pixel box. */
export function parseRegion(region) {
    const match = REGION_PATTERN.exec(region);
    if (match === null) {
        throw new VisionToolkitError('input', 'region must be four integers: X1,Y1,X2,Y2 (pixels)');
    }
    const box = {
        x1: Number(match[1]),
        y1: Number(match[2]),
        x2: Number(match[3]),
        y2: Number(match[4]),
    };
    if (box.x2 <= box.x1 || box.y2 <= box.y1) {
        throw new VisionToolkitError('input', 'region must have x2 > x1 and y2 > y1');
    }
    return box;
}
/** Runtime facade used by every native tool. */
export class VisionToolkitRuntime {
    ctx;
    config;
    semaphores = new Map();
    glanceCache = new WeakMap();
    adapter;
    constructor(ctx, config, adapter) {
        this.ctx = ctx;
        this.config = config;
        this.adapter = adapter ?? new UpstreamAdapter(ctx, config);
    }
    /** Pinned and prepared upstream identity. */
    get upstreamVersion() {
        return this.adapter.versionInfo;
    }
    timeout(options) {
        const value = options.timeoutMs ?? this.config.timeoutMs;
        if (!Number.isInteger(value) || value < 1000 || value > MAX_TIMEOUT_MS) {
            throw new VisionToolkitError('input', `timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}`);
        }
        return value;
    }
    operationError(tool, error, deadline, phase = 'execution') {
        if (deadline.cancelled) {
            return new VisionToolkitError('cancelled', phase === 'queue' ? `${tool}: cancelled while waiting for a concurrency slot` : `${tool}: cancelled`);
        }
        if (deadline.timedOut) {
            return new VisionToolkitError('timeout', phase === 'queue' ? `${tool}: timed out while waiting for a concurrency slot` : `${tool}: timed out`);
        }
        if (error instanceof VisionToolkitError)
            return error;
        return new VisionToolkitError('runtime', `${tool}: execution failed`, { cause: error });
    }
    semaphore(options) {
        const key = options.sessionId ?? `workspace:${options.workspace}`;
        const value = this.semaphores.get(key) ?? new Semaphore(this.config.concurrency);
        this.semaphores.set(key, value);
        return { key, value };
    }
    async runOperation(tool, options, action, permits = 1) {
        const timeoutMs = this.timeout(options);
        const semaphore = this.semaphore(options);
        const metrics = {
            startedAt: Date.now(),
            queueMs: 0,
            upstreamMs: 0,
            imageBytes: 0,
            imagePixels: 0,
            imageCount: 0,
            cacheHits: 0,
            usedVisionService: false,
        };
        let acquired = false;
        const queueDeadline = createDeadline(options.signal, timeoutMs);
        try {
            await semaphore.value.acquire(queueDeadline.signal, permits);
            acquired = true;
            if (queueDeadline.signal.aborted)
                throw this.operationError(tool, undefined, queueDeadline, 'queue');
            metrics.queueMs = Date.now() - metrics.startedAt;
        }
        catch (error) {
            metrics.queueMs = Date.now() - metrics.startedAt;
            const classified = this.operationError(tool, error, queueDeadline, 'queue');
            if (acquired) {
                semaphore.value.release(permits);
                acquired = false;
            }
            this.ctx.logger.warn('dsh-vision-toolkit tool=%s outcome=error category=%s totalMs=%d queueMs=%d upstreamMs=%d images=%d imageBytes=%d imagePixels=%d cacheHits=%d', tool, classified.code, Date.now() - metrics.startedAt, metrics.queueMs, metrics.upstreamMs, metrics.imageCount, metrics.imageBytes, metrics.imagePixels, metrics.cacheHits);
            throw classified;
        }
        finally {
            queueDeadline.cleanup();
            if (!acquired && semaphore.value.idle)
                this.semaphores.delete(semaphore.key);
        }
        const executionDeadline = createDeadline(options.signal, timeoutMs);
        try {
            if (executionDeadline.signal.aborted)
                throw this.operationError(tool, undefined, executionDeadline);
            const value = await action({ signal: executionDeadline.signal, metrics });
            if (executionDeadline.signal.aborted)
                throw this.operationError(tool, undefined, executionDeadline);
            this.ctx.logger.info('dsh-vision-toolkit tool=%s outcome=ok totalMs=%d queueMs=%d upstreamMs=%d images=%d imageBytes=%d imagePixels=%d cacheHits=%d model=%s', tool, Date.now() - metrics.startedAt, metrics.queueMs, metrics.upstreamMs, metrics.imageCount, metrics.imageBytes, metrics.imagePixels, metrics.cacheHits, metrics.usedVisionService ? this.config.provider.model : 'local');
            return value;
        }
        catch (error) {
            const classified = this.operationError(tool, error, executionDeadline);
            this.ctx.logger.warn('dsh-vision-toolkit tool=%s outcome=error category=%s totalMs=%d queueMs=%d upstreamMs=%d images=%d imageBytes=%d imagePixels=%d cacheHits=%d', tool, classified.code, Date.now() - metrics.startedAt, metrics.queueMs, metrics.upstreamMs, metrics.imageCount, metrics.imageBytes, metrics.imagePixels, metrics.cacheHits);
            throw classified;
        }
        finally {
            if (acquired)
                semaphore.value.release(permits);
            executionDeadline.cleanup();
            if (semaphore.value.idle)
                this.semaphores.delete(semaphore.key);
        }
    }
    /** Resolve the configured credential at the remote-operation boundary. */
    async resolveVisionEnv() {
        const resolved = isBuiltInFreeVisionProvider(this.config.provider)
            ? { value: BUILT_IN_FREE_VISION_KEY, source: 'built-in' }
            : await this.ctx.credentials.resolve(this.config.provider.credential);
        if (resolved === undefined) {
            throw new VisionToolkitError('config', `credential ${this.config.provider.credential} is not configured; set it through DSH credentials`);
        }
        return this.visionEnv(resolved);
    }
    visionEnv(resolved) {
        const sslVerify = process.env.VISION_SSL_VERIFY?.trim();
        return {
            VISION_API_KEY: resolved.value,
            VISION_BASE_URL: this.config.provider.baseUrl,
            VISION_MODEL: this.config.provider.model,
            VISION_API_PROTOCOL: this.config.provider.protocol === 'anthropic' ? 'anthropic' : 'chat_completions',
            VISION_ANTHROPIC_THINKING: this.config.provider.anthropicThinking,
            ...(sslVerify === undefined ? {} : { VISION_SSL_VERIFY: sslVerify }),
            VISION_USER_AGENT: this.config.provider.userAgent,
            LANG: this.config.language,
        };
    }
    pathPolicy(workspace) {
        return createPathPolicy(workspace, this.config.allowedDirs);
    }
    async compressedImageRoot(policy) {
        const root = join(policy.workspace, '.dsh-vision-toolkit', 'tmp', 'compressed-images');
        let current = policy.workspace;
        for (const segment of ['.dsh-vision-toolkit', 'tmp', 'compressed-images']) {
            current = join(current, segment);
            try {
                await mkdir(current, { mode: 0o700 });
            }
            catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
                    throw error;
            }
            const info = await lstat(current);
            if (info.isSymbolicLink() || !info.isDirectory()) {
                throw new VisionToolkitError('path', `compressed-image cache path is not a real directory: ${current}`);
            }
            if (!isWithin(policy.workspace, current)) {
                throw new VisionToolkitError('path', `compressed-image cache path escaped the workspace: ${current}`);
            }
        }
        const canonical = await realpath(root);
        if (!isWithin(policy.workspace, canonical)) {
            throw new VisionToolkitError('path', 'compressed-image cache resolved outside the workspace');
        }
        return canonical;
    }
    async readCacheCandidate(root, name, expectedOutDigestPrefix, maxBytes, maxPixels, operation) {
        const candidate = join(root, name);
        let info;
        try {
            info = await lstat(candidate);
        }
        catch {
            return undefined;
        }
        if (!info.isFile() || info.size < 1 || info.size > maxBytes)
            return undefined;
        let real;
        try {
            real = await realpath(candidate);
        }
        catch {
            return undefined;
        }
        if (!isWithin(root, real))
            return undefined;
        let bytes;
        try {
            bytes = await readFile(real, { signal: operation.signal });
        }
        catch {
            return undefined;
        }
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (bytes.length !== info.size || !digest.startsWith(expectedOutDigestPrefix))
            return undefined;
        let probed;
        try {
            probed = await this.adapter.probeImageSize(real, { signal: operation.signal });
        }
        catch {
            probed = undefined;
        }
        const extension = extname(real).toLowerCase();
        if (probed === undefined
            || FORMAT_BY_EXTENSION.get(extension) !== probed.format
            || probed.width * probed.height > maxPixels) {
            return undefined;
        }
        return { path: real, bytes: bytes.length, width: probed.width, height: probed.height, format: probed.format };
    }
    cacheEntryOutDigest(entry, prefix) {
        const tail = entry.slice(prefix.length + 1);
        return /^[0-9a-f]{16}-/u.test(tail) ? tail.slice(0, 16) : undefined;
    }
    async pruneCompressedCache(root) {
        let entries;
        try {
            entries = await readdir(root);
        }
        catch {
            return;
        }
        const stalePartials = [];
        const candidates = [];
        for (const name of entries) {
            if (name.startsWith('.')) {
                if (name.endsWith('.partial')) {
                    const info = await lstat(join(root, name)).catch(() => undefined);
                    if (info !== undefined && Date.now() - info.mtimeMs > COMPRESSED_IMAGE_CACHE_STALE_PARTIAL_MS) {
                        stalePartials.push(name);
                    }
                }
                continue;
            }
            let info;
            try {
                info = await lstat(join(root, name));
            }
            catch {
                continue;
            }
            candidates.push({
                name,
                size: info.isFile() ? info.size : 0,
                mtime: info.mtimeMs,
                removable: !info.isFile() || !name.startsWith(`${COMPRESSED_IMAGE_CACHE_VERSION}-`),
            });
        }
        candidates.sort((a, b) => a.mtime - b.mtime);
        let totalBytes = 0;
        let kept = 0;
        const remove = [];
        for (const candidate of candidates) {
            if (candidate.removable
                || totalBytes + candidate.size > COMPRESSED_IMAGE_CACHE_MAX_BYTES
                || kept >= COMPRESSED_IMAGE_CACHE_MAX_ENTRIES) {
                remove.push(candidate.name);
            }
            else {
                totalBytes += candidate.size;
                kept += 1;
            }
        }
        await Promise.all([...stalePartials, ...remove].map(name => rm(join(root, name), { force: true }).catch(() => { })));
    }
    async autoCompressImage(image, policy, operation) {
        let bytes;
        try {
            bytes = await readFile(image.path, { signal: operation.signal });
        }
        catch (error) {
            throw new VisionToolkitError('input', `image changed while preparing the vision request: ${image.path}`, { cause: error });
        }
        if (bytes.length !== image.bytes) {
            throw new VisionToolkitError('input', `image changed while preparing the vision request: ${image.path}`);
        }
        const digest = createHash('sha256').update(bytes).digest('hex').slice(0, COMPRESSED_IMAGE_CACHE_KEY_DIGEST_LENGTH);
        const root = await this.compressedImageRoot(policy);
        await this.pruneCompressedCache(root);
        const prefix = `${COMPRESSED_IMAGE_CACHE_VERSION}-${digest}-b${this.config.maxImageBytes}-p${this.config.maxImagePixels}`;
        for (const entry of await readdir(root)) {
            if (!entry.startsWith(`${prefix}-`) || entry.startsWith('.'))
                continue;
            const outDigestPrefix = this.cacheEntryOutDigest(entry, prefix);
            if (outDigestPrefix === undefined) {
                await rm(join(root, entry), { force: true }).catch(() => { });
                continue;
            }
            const cached = await this.readCacheCandidate(root, entry, outDigestPrefix, this.config.maxImageBytes, this.config.maxImagePixels, operation);
            if (cached !== undefined) {
                return { ...cached, originalPath: image.path };
            }
            await rm(join(root, entry), { force: true }).catch(() => { });
        }
        const staged = join(root, `.${prefix}-${randomUUID()}.partial`);
        let compressed;
        try {
            compressed = await this.adapter.compressImage(image.path, staged, this.config.maxImageBytes, this.config.maxImagePixels, { signal: operation.signal });
        }
        catch (error) {
            await rm(staged, { force: true }).catch(() => { });
            throw error;
        }
        const extension = compressed.format === 'jpeg' ? 'jpg' : compressed.format;
        const stagedBytes = await readFile(staged, { signal: operation.signal });
        const outDigest = createHash('sha256').update(stagedBytes).digest('hex').slice(0, COMPRESSED_IMAGE_CACHE_KEY_DIGEST_LENGTH);
        const finalName = `${prefix}-${outDigest}-${compressed.width}x${compressed.height}.${extension}`;
        const finalPath = join(root, finalName);
        const existing = await this.readCacheCandidate(root, finalName, outDigest, this.config.maxImageBytes, this.config.maxImagePixels, operation);
        if (existing !== undefined) {
            await rm(staged, { force: true }).catch(() => { });
            return { ...existing, originalPath: image.path };
        }
        await rm(finalPath, { force: true }).catch(() => { });
        try {
            await rename(staged, finalPath);
        }
        catch (error) {
            await rm(staged, { force: true }).catch(() => { });
            throw new VisionToolkitError('path', `cannot commit compressed image cache entry: ${finalPath}`, { cause: error });
        }
        await this.pruneCompressedCache(root);
        return {
            path: finalPath,
            bytes: compressed.bytes,
            width: compressed.width,
            height: compressed.height,
            format: compressed.format,
            originalPath: image.path,
        };
    }
    async validateImage(raw, policy, operation) {
        const image = await resolveInputFile(raw, policy);
        const decoded = await this.adapter.probeImageSize(image.path, { signal: operation.signal });
        const pixels = decoded.width * decoded.height;
        if (!Number.isSafeInteger(pixels) || pixels < 1) {
            throw new VisionToolkitError('input', `image dimensions are invalid: ${decoded.width}x${decoded.height}`);
        }
        const extension = extname(image.path).toLowerCase();
        const expected = FORMAT_BY_EXTENSION.get(extension);
        if (expected !== decoded.format) {
            throw new VisionToolkitError('input', `image content is ${decoded.format}, but the filename uses ${extension}`);
        }
        if (image.bytes <= this.config.maxImageBytes && pixels <= this.config.maxImagePixels) {
            return { ...image, width: decoded.width, height: decoded.height, format: decoded.format, originalPath: image.path };
        }
        return this.autoCompressImage(image, policy, operation);
    }
    accountImage(image, operation) {
        operation.metrics.imageCount += 1;
        operation.metrics.imageBytes += image.bytes;
        operation.metrics.imagePixels += image.width * image.height;
    }
    async glanceCacheKey(request, images, env, signal) {
        const imageFingerprints = await Promise.all(images.map(async (image) => {
            let bytes;
            try {
                bytes = await readFile(image.path, { signal });
            }
            catch (error) {
                throw new VisionToolkitError('input', `image changed while preparing the vision request: ${image.path}`, { cause: error });
            }
            if (bytes.length !== image.bytes) {
                throw new VisionToolkitError('input', `image changed while preparing the vision request: ${image.path}`);
            }
            return {
                path: image.path,
                sha256: createHash('sha256').update(bytes).digest('hex'),
            };
        }));
        return JSON.stringify({
            images: imageFingerprints,
            query: request.query ?? null,
            ocr: request.ocr === true,
            region: request.region ?? null,
            provider: {
                baseUrl: env.VISION_BASE_URL,
                model: env.VISION_MODEL,
                protocol: env.VISION_API_PROTOCOL,
                anthropicThinking: env.VISION_ANTHROPIC_THINKING,
                sslVerify: env.VISION_SSL_VERIFY ?? null,
                userAgent: env.VISION_USER_AGENT,
                language: env.LANG,
                credentialSha256: createHash('sha256').update(env.VISION_API_KEY).digest('hex'),
            },
        });
    }
    async runUpstream(tool, args, operation, env) {
        const started = Date.now();
        if (env !== undefined)
            operation.metrics.usedVisionService = true;
        const result = await this.adapter.run(tool, args, {
            signal: operation.signal,
            ...(env === undefined ? {} : { env }),
        });
        operation.metrics.upstreamMs += Date.now() - started;
        if (result.outcome.exitCode !== 0) {
            throw this.adapter.classifyFailure(tool, result, {
                timedOut: false,
                cancelled: operation.signal.aborted,
                ...(env === undefined ? {} : { secrets: [env.VISION_API_KEY] }),
            });
        }
        if (result.stdoutTruncated || result.stderrTruncated) {
            throw new VisionToolkitError('output', `${tool}: upstream output exceeded the capture limit`);
        }
        return result;
    }
    async probeGeneratedImage(path, operation, source) {
        try {
            return await this.adapter.probeImageSize(path, { signal: operation.signal });
        }
        catch (error) {
            if (operation.signal.aborted)
                throw error;
            throw new VisionToolkitError('output', `${source}: generated image is missing, corrupt, or unsupported`, { cause: error });
        }
    }
    async annotateLocations(tool, image, elements, output, policy, operation) {
        const extension = extname(image.originalPath).toLowerCase();
        const stem = basename(image.originalPath, extension);
        const suffix = tool === 'vision_ground' ? 'ground' : 'detect';
        const finalPath = resolveOutputFile(output, policy, `${stem}.${suffix}.preview.png`, ['.png']);
        assertDistinctOutput(image.path, finalPath);
        assertDistinctOutput(image.originalPath, finalPath);
        const staged = createStagedOutput(policy, '.png');
        try {
            const started = Date.now();
            await this.adapter.renderAnnotatedPreview(image.path, staged, elements, { signal: operation.signal });
            operation.metrics.upstreamMs += Date.now() - started;
            const preview = await this.probeGeneratedImage(staged, operation, tool);
            if (preview.format !== 'png' || preview.width !== image.width || preview.height !== image.height) {
                throw new VisionToolkitError('output', `${tool}: annotation preview dimensions or format do not match the source image`);
            }
            await commitStagedOutput(staged, finalPath, policy);
            return describeArtifact(finalPath, policy, {
                mimeType: 'image/png',
                kind: 'image',
                description: tool === 'vision_ground' ? 'Grounding bounding-box preview' : 'Detected-element bounding-box preview',
                sourceTool: tool,
                previewIntent: 'image',
            });
        }
        finally {
            await rm(staged, { force: true }).catch(() => { });
        }
    }
    /** glance: describe, targeted QA, OCR, or multi-image comparison. */
    async glance(request, options) {
        return this.runOperation('vision_glance', options, async (operation) => {
            if (request.images.length === 0)
                throw new VisionToolkitError('input', 'glance requires at least one image');
            if (request.query !== undefined && request.ocr === true) {
                throw new VisionToolkitError('input', 'glance: query and ocr are mutually exclusive');
            }
            if (request.region !== undefined && request.images.length > 1) {
                throw new VisionToolkitError('input', 'glance: region works with exactly one image');
            }
            if (request.region !== undefined)
                parseRegion(request.region);
            const policy = await this.pathPolicy(options.workspace);
            const images = [];
            const seen = new Set();
            for (const raw of request.images) {
                const image = await this.validateImage(raw, policy, operation);
                if (seen.has(image.path)) {
                    operation.metrics.cacheHits += 1;
                    continue;
                }
                seen.add(image.path);
                this.accountImage(image, operation);
                images.push(image);
            }
            const env = await this.resolveVisionEnv();
            const cacheKey = options.sessionScope === undefined
                ? undefined
                : await this.glanceCacheKey(request, images, env, operation.signal);
            if (options.sessionScope !== undefined && cacheKey !== undefined) {
                const cached = this.glanceCache.get(options.sessionScope);
                if (cached?.key === cacheKey) {
                    operation.metrics.cacheHits += 1;
                    return cached.result;
                }
            }
            const result = await this.runUpstream('glance', [
                ...images.map(image => image.path),
                ...(request.region !== undefined ? ['--region', request.region] : []),
                ...(request.ocr === true ? ['--ocr'] : []),
                ...(request.query !== undefined ? ['-q', request.query] : []),
            ], operation, env);
            const answer = result.stdout.trim();
            if (answer.length === 0)
                throw new VisionToolkitError('output', 'glance: vision API returned an empty description');
            const value = {
                images,
                mode: request.ocr === true ? 'ocr' : request.query !== undefined ? 'qa' : 'describe',
                answer,
                truncated: false,
            };
            if (options.sessionScope !== undefined && cacheKey !== undefined && !operation.signal.aborted) {
                this.glanceCache.set(options.sessionScope, { key: cacheKey, result: value });
            }
            return value;
        });
    }
    validateLocations(elements, width, height) {
        for (const element of elements) {
            const { x1, y1, x2, y2 } = element.box;
            if (![x1, y1, x2, y2].every(Number.isInteger)
                || x1 < 0
                || y1 < 0
                || x2 <= x1
                || y2 <= y1
                || x2 > width
                || y2 > height) {
                throw new VisionToolkitError('output', `upstream returned an out-of-range box for ${width}x${height}`);
            }
        }
    }
    async locate(request, options, operation, tool) {
        if (request.target.trim().length === 0)
            throw new VisionToolkitError('input', 'target must not be empty');
        if (request.region !== undefined)
            parseRegion(request.region);
        const policy = await this.pathPolicy(options.workspace);
        const image = await this.validateImage(request.image, policy, operation);
        this.accountImage(image, operation);
        const env = await this.resolveVisionEnv();
        const result = await this.runUpstream(tool, [
            image.path,
            request.target,
            ...(request.region !== undefined ? ['--region', request.region] : []),
        ], operation, env);
        const elements = parseLocationOutput(result.stdout);
        this.validateLocations(elements, image.width, image.height);
        return { image, elements };
    }
    /** ground: locate one named target and return pixel boxes. */
    async ground(request, options) {
        return this.runOperation('vision_ground', options, async (operation) => {
            const { image, elements } = await this.locate(request, options, operation, 'ground');
            const labeled = elements.map(element => ({ label: element.label ?? request.target, box: element.box }));
            const preview = request.preview === true
                ? await this.annotateLocations('vision_ground', image, labeled, request.previewOutput, await this.pathPolicy(options.workspace), operation)
                : undefined;
            return {
                target: request.target,
                image,
                imageWidth: image.width,
                imageHeight: image.height,
                matches: labeled,
                ...(preview === undefined ? {} : { preview }),
            };
        });
    }
    /** detect: inventory every instance of a kind. */
    async detect(request, options) {
        return this.runOperation('vision_detect', options, async (operation) => {
            const { image, elements } = await this.locate(request, options, operation, 'detect');
            const labeled = elements.map(element => ({ label: element.label ?? request.target, box: element.box }));
            const preview = request.preview === true
                ? await this.annotateLocations('vision_detect', image, labeled, request.previewOutput, await this.pathPolicy(options.workspace), operation)
                : undefined;
            return {
                category: request.target,
                image,
                imageWidth: image.width,
                imageHeight: image.height,
                elements: labeled.map((element, index) => ({
                    index: index + 1,
                    label: element.label,
                    box: element.box,
                })),
                ...(preview === undefined ? {} : { preview }),
            };
        });
    }
    /** crop: cut a pixel box into its own image file without requiring a credential. */
    async crop(request, options) {
        return this.runOperation('vision_crop', options, async (operation) => {
            const region = parseRegion(request.region);
            if (request.scale !== undefined && (!Number.isInteger(request.scale) || request.scale < 1 || request.scale > 8)) {
                throw new VisionToolkitError('input', 'crop: scale must be an integer between 1 and 8');
            }
            const policy = await this.pathPolicy(options.workspace);
            const image = await this.validateImage(request.image, policy, operation);
            this.accountImage(image, operation);
            const sourceExtension = extname(image.originalPath).toLowerCase();
            const stem = basename(image.originalPath, sourceExtension);
            const finalPath = resolveOutputFile(request.output, policy, request.scale !== undefined && request.scale > 1 ? `${stem}.crop@${request.scale}x.png` : `${stem}.crop.png`, ['.png', '.jpg', '.jpeg']);
            assertDistinctOutput(image.path, finalPath);
            assertDistinctOutput(image.originalPath, finalPath);
            const outputExtension = extname(finalPath).toLowerCase();
            const staged = createStagedOutput(policy, outputExtension);
            try {
                const result = await this.runUpstream('crop', [
                    image.path,
                    '--region',
                    request.region,
                    '-o',
                    staged,
                    ...(request.scale !== undefined ? ['--scale', String(request.scale)] : []),
                ], operation);
                const parsed = parseCropOutput(result.stdout, result.stderr);
                const generated = await this.probeGeneratedImage(staged, operation, 'crop');
                const expectedFormat = outputExtension === '.png' ? 'png' : 'jpeg';
                if (generated.format !== expectedFormat
                    || generated.width !== parsed.width
                    || generated.height !== parsed.height) {
                    throw new VisionToolkitError('output', 'crop: generated image does not match the upstream summary');
                }
                await commitStagedOutput(staged, finalPath, policy);
                const mimeType = outputExtension === '.png' ? 'image/png' : 'image/jpeg';
                const artifact = await describeArtifact(finalPath, policy, {
                    mimeType,
                    kind: 'image',
                    description: 'Cropped image region',
                    sourceTool: 'vision_crop',
                    previewIntent: 'image',
                });
                return {
                    imageWidth: image.width,
                    imageHeight: image.height,
                    region,
                    outputPath: finalPath,
                    mimeType,
                    width: parsed.width,
                    height: parsed.height,
                    clamped: parsed.clamped,
                    artifact,
                    ...(parsed.note === undefined ? {} : { note: parsed.note }),
                };
            }
            finally {
                await rm(staged, { force: true }).catch(() => { });
            }
        });
    }
    /** trace: recover an SVG through the pinned upstream vtracer pipeline. */
    async trace(request, options) {
        return this.runOperation('vision_trace', options, async (operation) => {
            if (request.region !== undefined)
                parseRegion(request.region);
            if (request.scale !== undefined && (!Number.isInteger(request.scale) || request.scale < 1 || request.scale > 16)) {
                throw new VisionToolkitError('input', 'trace: scale must be an integer between 1 and 16');
            }
            const policy = await this.pathPolicy(options.workspace);
            const image = await this.validateImage(request.image, policy, operation);
            this.accountImage(image, operation);
            const extension = extname(image.originalPath).toLowerCase();
            const stem = basename(image.originalPath, extension);
            const finalPath = resolveOutputFile(request.output, policy, `${stem}.svg`, ['.svg']);
            assertDistinctOutput(image.path, finalPath);
            assertDistinctOutput(image.originalPath, finalPath);
            const staged = createStagedOutput(policy, '.svg');
            try {
                const result = await this.runUpstream('trace', [
                    image.path,
                    ...(request.region !== undefined ? ['--region', request.region] : []),
                    ...(request.scale !== undefined ? ['--scale', String(request.scale)] : []),
                    ...(request.polygon === true ? ['--polygon'] : []),
                    ...(request.color === true ? ['--color'] : []),
                    '-o',
                    staged,
                ], operation);
                const parsed = parseTraceOutput(result.stdout);
                const svg = await readFile(staged, 'utf8').catch(() => '');
                const actualPathCount = svgDocumentPathCount(svg);
                if (actualPathCount === undefined) {
                    throw new VisionToolkitError('output', 'trace: output SVG is not a parseable document');
                }
                if (actualPathCount !== parsed.pathCount) {
                    throw new VisionToolkitError('output', 'trace: reported path count does not match the generated SVG');
                }
                const svgInfo = await stat(staged);
                if (svgInfo.size !== parsed.bytes) {
                    throw new VisionToolkitError('output', 'trace: reported byte count does not match the generated SVG');
                }
                await commitStagedOutput(staged, finalPath, policy);
                const artifact = await describeArtifact(finalPath, policy, {
                    mimeType: 'image/svg+xml',
                    kind: 'svg',
                    description: 'Traced vector geometry',
                    sourceTool: 'vision_trace',
                    previewIntent: 'svg',
                });
                const warning = result.stderr.trim();
                return {
                    imageWidth: image.width,
                    imageHeight: image.height,
                    outputPath: finalPath,
                    mimeType: 'image/svg+xml',
                    geometry: {
                        status: parsed.pathCount === 0 ? 'empty' : 'generated',
                        pathCount: parsed.pathCount,
                        tracedScale: parsed.tracedScale,
                        bytes: parsed.bytes,
                    },
                    artifact,
                    ...(warning.length === 0 ? {} : { warning: warning.split(/\r?\n/).slice(-1)[0] ?? warning }),
                };
            }
            finally {
                await rm(staged, { force: true }).catch(() => { });
            }
        });
    }
    /** pixel_diff: compare real pixels, rank error regions, and deliver a heatmap plus JSON report. */
    async pixelDiff(request, options) {
        return this.runOperation('vision_pixel_diff', options, async (operation) => {
            const grid = integerInRange(request.grid, 6, 1, 32, 'pixel_diff.grid');
            const top = integerInRange(request.top, 5, 1, grid * grid, 'pixel_diff.top');
            const policy = await this.pathPolicy(options.workspace);
            const original = await this.validateImage(request.original, policy, operation);
            const rebuilt = await this.validateImage(request.rebuilt, policy, operation);
            this.accountImage(original, operation);
            this.accountImage(rebuilt, operation);
            const originalStem = basename(original.originalPath, extname(original.originalPath));
            const rebuiltStem = basename(rebuilt.originalPath, extname(rebuilt.originalPath));
            const finalDirectory = resolveOutputDirectory(request.runName, policy, `${originalStem}-vs-${rebuiltStem}.pixel-diff`);
            if (isWithin(finalDirectory, original.path)
                || isWithin(finalDirectory, rebuilt.path)
                || isWithin(finalDirectory, original.originalPath)
                || isWithin(finalDirectory, rebuilt.originalPath)) {
                throw new VisionToolkitError('input', 'pixel_diff artifact directory would replace an input image');
            }
            const stagedDirectory = await createStagedDirectory(policy);
            const stagedHeatmap = join(stagedDirectory, 'heatmap.png');
            const stagedReport = join(stagedDirectory, 'report.json');
            try {
                const result = await this.runUpstream('pixel_diff', [
                    original.path,
                    rebuilt.path,
                    '--grid',
                    String(grid),
                    '--top',
                    String(top),
                    '-o',
                    stagedHeatmap,
                ], operation);
                const parsed = parsePixelDiffOutput(result.stdout);
                if (parsed.heatmapPath !== stagedHeatmap) {
                    throw new VisionToolkitError('output', 'pixel_diff: upstream reported an unexpected heatmap path');
                }
                if (!Number.isFinite(parsed.overallDifferencePct) || parsed.overallDifferencePct < 0 || parsed.overallDifferencePct > 100) {
                    throw new VisionToolkitError('output', 'pixel_diff: overall difference is outside 0-100%');
                }
                if (parsed.scaled !== (original.width !== rebuilt.width || original.height !== rebuilt.height)
                    || (parsed.scaledToSize !== undefined
                        && (parsed.scaledToSize.width !== original.width || parsed.scaledToSize.height !== original.height))
                    || parsed.worstRegions.length > top
                    || parsed.worstRegions.some((region, index) => region.index !== index + 1)) {
                    throw new VisionToolkitError('output', 'pixel_diff: scaling or ranked-region metadata is inconsistent');
                }
                for (const region of parsed.worstRegions)
                    assertBoxWithin(region.box, original.width, original.height, 'pixel_diff');
                const heatmapInfo = await this.probeGeneratedImage(stagedHeatmap, operation, 'pixel_diff');
                if (heatmapInfo.format !== 'png' || heatmapInfo.width !== original.width || heatmapInfo.height !== original.height) {
                    throw new VisionToolkitError('output', 'pixel_diff: heatmap dimensions or format do not match the reference image');
                }
                const reportPayload = {
                    schemaVersion: 1,
                    sourceTool: 'vision_pixel_diff',
                    original,
                    rebuilt,
                    scaled: parsed.scaled,
                    ...(parsed.rebuiltOriginalSize === undefined ? {} : { rebuiltOriginalSize: parsed.rebuiltOriginalSize }),
                    overallDifferencePct: parsed.overallDifferencePct,
                    grid,
                    worstRegions: parsed.worstRegions,
                };
                await writeFile(stagedReport, `${JSON.stringify(reportPayload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
                await commitStagedDirectory(stagedDirectory, finalDirectory, policy);
                const heatmapPath = join(finalDirectory, 'heatmap.png');
                const reportPath = join(finalDirectory, 'report.json');
                const [heatmap, report] = await Promise.all([
                    describeArtifact(heatmapPath, policy, {
                        mimeType: 'image/png',
                        kind: 'image',
                        description: 'Pixel-difference heatmap',
                        sourceTool: 'vision_pixel_diff',
                        previewIntent: 'image',
                    }),
                    describeArtifact(reportPath, policy, {
                        mimeType: 'application/json',
                        kind: 'json',
                        description: 'Structured pixel-difference report',
                        sourceTool: 'vision_pixel_diff',
                        previewIntent: 'text',
                    }),
                ]);
                return {
                    original,
                    rebuilt,
                    scaled: parsed.scaled,
                    ...(parsed.rebuiltOriginalSize === undefined ? {} : { rebuiltOriginalSize: parsed.rebuiltOriginalSize }),
                    overallDifferencePct: parsed.overallDifferencePct,
                    worstRegions: parsed.worstRegions,
                    heatmap,
                    report,
                };
            }
            finally {
                await rm(stagedDirectory, { recursive: true, force: true }).catch(() => { });
            }
        });
    }
    /** long_screenshot_ocr: split safely, optionally OCR, and atomically deliver the complete audit run. */
    async longScreenshotOcr(request, options) {
        const jobs = integerInRange(request.jobs, Math.min(2, this.config.concurrency), 1, this.config.concurrency, 'long_screenshot_ocr.jobs');
        const splitOnly = request.splitOnly === true;
        const permits = splitOnly ? 1 : jobs;
        return this.runOperation('vision_long_screenshot_ocr', options, async (operation) => {
            const mode = request.mode ?? 'general';
            if (mode !== 'general' && mode !== 'chat')
                throw new VisionToolkitError('input', 'long_screenshot_ocr.mode must be general or chat');
            const targetHeight = request.targetHeight === undefined
                ? undefined
                : integerInRange(request.targetHeight, request.targetHeight, 64, 100000, 'long_screenshot_ocr.targetHeight');
            const minHeight = request.minHeight === undefined
                ? undefined
                : integerInRange(request.minHeight, request.minHeight, 64, 100000, 'long_screenshot_ocr.minHeight');
            const maxHeight = request.maxHeight === undefined
                ? undefined
                : integerInRange(request.maxHeight, request.maxHeight, 64, 100000, 'long_screenshot_ocr.maxHeight');
            if (minHeight !== undefined && maxHeight !== undefined && minHeight > maxHeight) {
                throw new VisionToolkitError('input', 'long_screenshot_ocr.minHeight must not exceed maxHeight');
            }
            if (targetHeight !== undefined && minHeight !== undefined && targetHeight < minHeight) {
                throw new VisionToolkitError('input', 'long_screenshot_ocr.targetHeight must not be below minHeight');
            }
            if (targetHeight !== undefined && maxHeight !== undefined && targetHeight > maxHeight) {
                throw new VisionToolkitError('input', 'long_screenshot_ocr.targetHeight must not exceed maxHeight');
            }
            const overlap = request.overlap === undefined
                ? undefined
                : integerInRange(request.overlap, request.overlap, 0, 10000, 'long_screenshot_ocr.overlap');
            const chunkTimeoutSeconds = finiteInRange(request.chunkTimeoutSeconds ?? Math.min(180, Math.max(1, Math.ceil(this.timeout(options) / 1000))), 1, 600, 'long_screenshot_ocr.chunkTimeoutSeconds');
            if (chunkTimeoutSeconds === undefined)
                throw new VisionToolkitError('input', 'long_screenshot_ocr chunk timeout is required');
            if (request.prompt !== undefined && request.prompt.trim().length === 0) {
                throw new VisionToolkitError('input', 'long_screenshot_ocr.prompt must not be empty when provided');
            }
            const policy = await this.pathPolicy(options.workspace);
            const image = await this.validateImage(request.image, policy, operation);
            this.accountImage(image, operation);
            const stem = basename(image.originalPath, extname(image.originalPath));
            const finalDirectory = resolveOutputDirectory(request.runName, policy, `${stem}.long-ocr`);
            if (isWithin(finalDirectory, image.path) || isWithin(finalDirectory, image.originalPath)) {
                throw new VisionToolkitError('input', 'long_screenshot_ocr artifact directory would replace the input image');
            }
            const stagedDirectory = await createStagedDirectory(policy);
            try {
                if (request.resume === true)
                    await seedStagedDirectory(finalDirectory, stagedDirectory, policy);
                const stagedPolicy = { ...policy, outputDir: stagedDirectory };
                const stagedOutput = resolveOutputFile(request.output, stagedPolicy, `${stem}.ocr.md`, ['.md', '.markdown']);
                const finalOutput = join(finalDirectory, basename(stagedOutput));
                const stagedChunks = join(stagedDirectory, 'chunks');
                const stagedManifest = join(stagedChunks, 'manifest.json');
                const result = await this.runUpstream('long_screenshot_ocr', [
                    image.path,
                    '--mode',
                    mode,
                    '-o',
                    stagedOutput,
                    '--chunks-dir',
                    stagedChunks,
                    ...(targetHeight === undefined ? [] : ['--target-height', String(targetHeight)]),
                    ...(minHeight === undefined ? [] : ['--min-height', String(minHeight)]),
                    ...(maxHeight === undefined ? [] : ['--max-height', String(maxHeight)]),
                    ...(overlap === undefined ? [] : ['--overlap', String(overlap)]),
                    ...(request.prompt === undefined ? [] : ['--prompt', request.prompt]),
                    '--jobs',
                    String(jobs),
                    '--timeout',
                    String(chunkTimeoutSeconds),
                    ...(splitOnly ? ['--split-only'] : []),
                    ...(request.resume === true ? ['--resume'] : []),
                ], operation, splitOnly ? undefined : await this.resolveVisionEnv());
                const reported = result.stdout.trim();
                const expectedReported = splitOnly ? stagedManifest : stagedOutput;
                if (reported !== expectedReported) {
                    throw new VisionToolkitError('output', 'long_screenshot_ocr: upstream reported an unexpected output path');
                }
                const parsedManifest = parseLongOcrManifest(await readFile(stagedManifest, 'utf8'), {
                    source: image.path,
                    output: stagedOutput,
                    width: image.width,
                    height: image.height,
                    mode,
                    splitOnly,
                });
                for (const chunk of parsedManifest.chunks) {
                    const chunkBytes = await readFile(join(stagedChunks, chunk.image));
                    if (createHash('sha256').update(chunkBytes).digest('hex') !== chunk.imageSha256) {
                        throw new VisionToolkitError('output', `long_screenshot_ocr: chunk ${chunk.index} hash does not match the manifest`);
                    }
                }
                parsedManifest.raw.output = splitOnly ? null : finalOutput;
                await writeFile(stagedManifest, `${JSON.stringify(parsedManifest.raw, null, 2)}\n`, 'utf8');
                await commitStagedDirectory(stagedDirectory, finalDirectory, policy);
                const finalChunks = join(finalDirectory, 'chunks');
                const manifest = await describeArtifact(join(finalChunks, 'manifest.json'), policy, {
                    mimeType: 'application/json',
                    kind: 'json',
                    description: 'Long-screenshot split and merge manifest',
                    sourceTool: 'vision_long_screenshot_ocr',
                    previewIntent: 'text',
                });
                const output = splitOnly
                    ? undefined
                    : await describeArtifact(finalOutput, policy, {
                        mimeType: 'text/markdown',
                        kind: 'markdown',
                        description: 'Merged long-screenshot OCR transcript',
                        sourceTool: 'vision_long_screenshot_ocr',
                        previewIntent: 'text',
                    });
                const audit = splitOnly
                    ? undefined
                    : await describeArtifact(join(finalChunks, 'ocr_audit.md'), policy, {
                        mimeType: 'text/markdown',
                        kind: 'markdown',
                        description: 'Long-screenshot OCR boundary audit',
                        sourceTool: 'vision_long_screenshot_ocr',
                        previewIntent: 'text',
                    });
                const chunks = [];
                for (const chunk of parsedManifest.chunks) {
                    const chunkImage = await describeArtifact(join(finalChunks, chunk.image), policy, {
                        mimeType: 'image/png',
                        kind: 'image',
                        description: `Long-screenshot OCR chunk ${chunk.index}`,
                        sourceTool: 'vision_long_screenshot_ocr',
                        previewIntent: 'image',
                    });
                    const ocr = chunk.ocr === undefined
                        ? undefined
                        : await describeArtifact(join(finalChunks, chunk.ocr), policy, {
                            mimeType: mode === 'chat' ? 'application/json' : 'text/markdown',
                            kind: mode === 'chat' ? 'json' : 'markdown',
                            description: `OCR sidecar for chunk ${chunk.index}`,
                            sourceTool: 'vision_long_screenshot_ocr',
                            previewIntent: 'text',
                        });
                    chunks.push({
                        index: chunk.index,
                        coreTop: chunk.coreTop,
                        coreBottom: chunk.coreBottom,
                        cropTop: chunk.cropTop,
                        cropBottom: chunk.cropBottom,
                        image: chunkImage,
                        ...(ocr === undefined ? {} : { ocr }),
                        ...(chunk.ocrReused === undefined ? {} : { reused: chunk.ocrReused }),
                    });
                }
                return {
                    source: image,
                    mode,
                    splitOnly,
                    complete: parsedManifest.complete,
                    chunkCount: chunks.length,
                    runDirectory: finalDirectory,
                    ...(output === undefined ? {} : { output }),
                    manifest,
                    ...(audit === undefined ? {} : { audit }),
                    chunks,
                };
            }
            finally {
                await rm(stagedDirectory, { recursive: true, force: true }).catch(() => { });
            }
        }, permits);
    }
    /** extract_foreground: preserve the pinned component selection and deliver an RGBA PNG. */
    async extractForeground(request, options) {
        return this.runOperation('vision_extract_foreground', options, async (operation) => {
            const policy = await this.pathPolicy(options.workspace);
            const image = await this.validateImage(request.image, policy, operation);
            this.accountImage(image, operation);
            const region = request.region === undefined ? undefined : parseRegion(request.region);
            if (region !== undefined)
                assertBoxWithin(region, image.width, image.height, 'extract_foreground.region');
            const boxes = request.boxes === undefined ? undefined : parseRegion(request.boxes);
            if (boxes !== undefined)
                assertBoxWithin(boxes, image.width, image.height, 'extract_foreground.boxes');
            const discRadius = finiteInRange(request.discRadius, 1, Math.max(image.width, image.height) * 4, 'extract_foreground.discRadius');
            const saturation = integerInRange(request.saturation, 12, 0, 255, 'extract_foreground.saturation');
            const darkThreshold = integerInRange(request.darkThreshold, 215, 0, 255, 'extract_foreground.darkThreshold');
            const excludeTolerance = finiteInRange(request.excludeTolerance ?? 24, 0, 442, 'extract_foreground.excludeTolerance');
            const padding = integerInRange(request.padding, 3, 0, 4096, 'extract_foreground.padding');
            const excludeColor = request.excludeColor === undefined
                ? undefined
                : `#${request.excludeColor.trim().replace(/^#/, '').toUpperCase()}`;
            if (excludeColor !== undefined && !HEX_COLOR_PATTERN.test(excludeColor)) {
                throw new VisionToolkitError('input', 'extract_foreground.excludeColor must be #RRGGBB');
            }
            const extension = extname(image.originalPath).toLowerCase();
            const stem = basename(image.originalPath, extension);
            const finalPath = resolveOutputFile(request.output, policy, `${stem}.foreground.png`, ['.png']);
            assertDistinctOutput(image.path, finalPath);
            assertDistinctOutput(image.originalPath, finalPath);
            const staged = createStagedOutput(policy, '.png');
            try {
                const result = await this.runUpstream('extract_foreground', [
                    image.path,
                    ...(region === undefined ? [] : ['--region', `${region.x1},${region.y1},${region.x2},${region.y2}`]),
                    ...(boxes === undefined ? [] : ['--boxes', `${boxes.x1},${boxes.y1},${boxes.x2},${boxes.y2}`]),
                    '--mode',
                    request.mode ?? 'color',
                    '--sat',
                    String(saturation),
                    '--dark',
                    String(darkThreshold),
                    '--exclude-tol',
                    String(excludeTolerance),
                    '--pad',
                    String(padding),
                    ...(discRadius === undefined ? [] : ['--disc-radius', String(discRadius)]),
                    ...(excludeColor === undefined ? [] : ['--exclude-color', excludeColor]),
                    ...(request.keepWhites === false ? ['--no-keep-whites'] : []),
                    '-o',
                    staged,
                ], operation);
                const parsed = parseExtractForegroundOutput(result.stdout);
                if (parsed.outputPath !== staged)
                    throw new VisionToolkitError('output', 'extract_foreground: upstream reported an unexpected output path');
                assertBoxWithin(parsed.box, image.width, image.height, 'extract_foreground');
                if (parsed.foregroundPixels <= 0
                    || parsed.keptComponents <= 0
                    || parsed.totalComponents < parsed.keptComponents
                    || parsed.largestComponentPct < 0
                    || parsed.largestComponentPct > 100) {
                    throw new VisionToolkitError('output', 'extract_foreground: component metrics are invalid');
                }
                const generated = await this.probeGeneratedImage(staged, operation, 'extract_foreground');
                if (generated.format !== 'png'
                    || (generated.mode !== 'RGBA' && generated.mode !== 'LA')
                    || generated.width !== parsed.width
                    || generated.height !== parsed.height) {
                    throw new VisionToolkitError('output', 'extract_foreground: output is not the reported transparent PNG');
                }
                await commitStagedOutput(staged, finalPath, policy);
                const artifact = await describeArtifact(finalPath, policy, {
                    mimeType: 'image/png',
                    kind: 'image',
                    description: 'Extracted transparent foreground',
                    sourceTool: 'vision_extract_foreground',
                    previewIntent: 'image',
                });
                return {
                    source: image,
                    box: parsed.box,
                    foregroundPixels: parsed.foregroundPixels,
                    keptComponents: parsed.keptComponents,
                    totalComponents: parsed.totalComponents,
                    largestComponentPct: parsed.largestComponentPct,
                    width: parsed.width,
                    height: parsed.height,
                    artifact,
                    ...(parsed.autoSummary === undefined ? {} : { autoSummary: parsed.autoSummary }),
                };
            }
            finally {
                await rm(staged, { force: true }).catch(() => { });
            }
        });
    }
    /** dominant_colors: expose palette clusters or candidate scores as structure, never stdout prose. */
    async dominantColors(request, options) {
        return this.runOperation('vision_dominant_colors', options, async (operation) => {
            const top = integerInRange(request.top, 5, 1, 64, 'dominant_colors.top');
            const quantize = integerInRange(request.quantize, 16, 2, 256, 'dominant_colors.quantize');
            const maxPixels = integerInRange(request.maxPixels, 96, 8, 4096, 'dominant_colors.maxPixels');
            const mergeTolerance = integerInRange(request.mergeTolerance, 8, 0, 255, 'dominant_colors.mergeTolerance');
            const candidateTolerance = integerInRange(request.candidateTolerance, 16, 0, 255, 'dominant_colors.candidateTolerance');
            const policy = await this.pathPolicy(options.workspace);
            const image = await this.validateImage(request.image, policy, operation);
            this.accountImage(image, operation);
            const region = request.region === undefined ? undefined : parseRegion(request.region);
            if (region !== undefined)
                assertBoxWithin(region, image.width, image.height, 'dominant_colors.region');
            const candidates = request.candidates?.map(value => `#${value.trim().replace(/^#/, '').toUpperCase()}`);
            if (candidates !== undefined) {
                if (candidates.length === 0 || candidates.length > 32) {
                    throw new VisionToolkitError('input', 'dominant_colors.candidates must contain between 1 and 32 colors');
                }
                if (candidates.some(candidate => !HEX_COLOR_PATTERN.test(candidate))) {
                    throw new VisionToolkitError('input', 'dominant_colors.candidates must contain only #RRGGBB colors');
                }
                if (new Set(candidates).size !== candidates.length) {
                    throw new VisionToolkitError('input', 'dominant_colors.candidates must not contain duplicates');
                }
            }
            const result = await this.runUpstream('dominant_colors', [
                image.path,
                ...(region === undefined ? [] : ['--region', `${region.x1},${region.y1},${region.x2},${region.y2}`]),
                ...(candidates === undefined ? [] : ['--candidates', candidates.join(',')]),
                '--top',
                String(top),
                '--quantize',
                String(quantize),
                '--max-pixels',
                String(maxPixels),
                '--merge-tol',
                String(mergeTolerance),
                '--tol',
                String(candidateTolerance),
            ], operation);
            const analysis = parseDominantColorsOutput(result.stdout);
            assertBoxWithin(analysis.region, image.width, image.height, 'dominant_colors');
            if (analysis.width !== analysis.region.x2 - analysis.region.x1 || analysis.height !== analysis.region.y2 - analysis.region.y1) {
                throw new VisionToolkitError('output', 'dominant_colors: reported region dimensions are inconsistent');
            }
            if (candidates !== undefined) {
                if (analysis.mode !== 'candidates')
                    throw new VisionToolkitError('output', 'dominant_colors: expected candidate mode output');
                if (analysis.candidates.map(candidate => candidate.color).join(',') !== candidates.join(',')) {
                    throw new VisionToolkitError('output', 'dominant_colors: candidate rows do not match the request');
                }
            }
            else if (analysis.mode !== 'palette') {
                throw new VisionToolkitError('output', 'dominant_colors: expected palette mode output');
            }
            return { image, analysis };
        });
    }
    /** html_screenshot: render only a path-fenced local HTML file in the pinned Chrome adapter. */
    async htmlScreenshot(request, options) {
        return this.runOperation('vision_html_screenshot', options, async (operation) => {
            const width = integerInRange(request.width, 1280, 1, 8192, 'html_screenshot.width');
            const height = integerInRange(request.height, 800, 1, 8192, 'html_screenshot.height');
            const scale = integerInRange(request.scale, 1, 1, 4, 'html_screenshot.scale');
            const waitMs = integerInRange(request.waitMs, 0, 0, 120000, 'html_screenshot.waitMs');
            const fullPage = request.fullPage === true;
            const outputPixels = width * height * scale * scale;
            if (!Number.isSafeInteger(outputPixels) || outputPixels > this.config.maxImagePixels) {
                throw new VisionToolkitError('capacity', `HTML screenshot would create ${outputPixels} pixels, exceeding maxImagePixels ${this.config.maxImagePixels}`);
            }
            const policy = await this.pathPolicy(options.workspace);
            const source = await resolveHtmlFile(request.source, policy);
            if (source.bytes > this.config.maxImageBytes) {
                throw new VisionToolkitError('capacity', `HTML source is ${source.bytes} bytes, exceeding maxImageBytes ${this.config.maxImageBytes}`);
            }
            const stem = basename(source.path, extname(source.path));
            const finalPath = resolveOutputFile(request.output, policy, `${stem}.screenshot.png`, ['.png']);
            assertDistinctOutput(source.path, finalPath);
            const staged = createStagedOutput(policy, '.png');
            try {
                const result = await this.runUpstream('html_screenshot', [
                    source.path,
                    '-o',
                    staged,
                    '--width',
                    String(width),
                    '--height',
                    String(height),
                    '--scale',
                    String(scale),
                    '--wait-ms',
                    String(waitMs),
                    ...(fullPage ? ['--full-page', '--max-pixels', String(this.config.maxImagePixels)] : []),
                ], operation);
                const parsed = parseHtmlScreenshotOutput(result.stdout);
                const expectedWidth = width * scale;
                if (parsed.outputPath !== staged || parsed.width !== expectedWidth) {
                    throw new VisionToolkitError('output', 'html_screenshot: upstream summary does not match the requested output');
                }
                if (fullPage !== (parsed.pageHeight !== undefined)) {
                    throw new VisionToolkitError('output', 'html_screenshot: upstream full-page metadata does not match the request');
                }
                const pageHeight = parsed.pageHeight;
                const expectedHeight = pageHeight === undefined ? height * scale : pageHeight * scale;
                if (pageHeight !== undefined && (!Number.isInteger(pageHeight) || pageHeight <= 0)) {
                    throw new VisionToolkitError('output', 'html_screenshot: upstream reported an invalid page height');
                }
                const outputPixels = expectedWidth * expectedHeight;
                if (!Number.isSafeInteger(outputPixels) || outputPixels > this.config.maxImagePixels) {
                    throw new VisionToolkitError('capacity', `HTML screenshot would create ${outputPixels} pixels, exceeding maxImagePixels ${this.config.maxImagePixels}`);
                }
                if (parsed.height !== expectedHeight) {
                    throw new VisionToolkitError('output', 'html_screenshot: upstream summary does not match the requested output');
                }
                const generated = await this.probeGeneratedImage(staged, operation, 'html_screenshot');
                if (generated.format !== 'png' || generated.width !== expectedWidth || generated.height !== expectedHeight) {
                    throw new VisionToolkitError('output', 'html_screenshot: generated PNG dimensions do not match the reported output');
                }
                await commitStagedOutput(staged, finalPath, policy);
                const artifact = await describeArtifact(finalPath, policy, {
                    mimeType: 'image/png',
                    kind: 'image',
                    description: 'Headless browser screenshot of local HTML',
                    sourceTool: 'vision_html_screenshot',
                    previewIntent: 'image',
                });
                return {
                    sourcePath: source.path,
                    sourceBytes: source.bytes,
                    viewport: { width, height, scale },
                    width: expectedWidth,
                    height: expectedHeight,
                    ...(pageHeight === undefined ? {} : { pageHeight }),
                    artifact,
                };
            }
            finally {
                await rm(staged, { force: true }).catch(() => { });
            }
        });
    }
    async writableDirectoryCheck(path, label) {
        const probe = join(path, `.vision-toolkit-health-${randomUUID()}`);
        try {
            await writeFile(probe, 'ok\n', { encoding: 'utf8', flag: 'wx' });
            await rm(probe, { force: true });
            return { status: 'ok', detail: `${label} is writable: ${path}` };
        }
        catch {
            await rm(probe, { force: true }).catch(() => { });
            return { status: 'error', detail: `${label} is not writable: ${path}` };
        }
    }
    /** Health: inspect local readiness, optionally probe `/models`, and explicitly test one real multimodal request. */
    async health(testConnection, options, testModel = false) {
        return this.runOperation('vision_toolkit_health', options, async (operation) => {
            const info = this.upstreamVersion;
            const python = { status: 'ok', detail: `${info.pythonVersion} via ${info.python}` };
            const dependencies = {
                status: 'ok',
                detail: Object.entries(info.dependencies).map(([name, version]) => `${name}=${version}`).join(', '),
            };
            let chrome;
            try {
                const started = Date.now();
                const chromePath = await this.adapter.findChrome({ signal: operation.signal });
                operation.metrics.upstreamMs += Date.now() - started;
                chrome = chromePath === undefined
                    ? { status: 'warning', detail: 'Chrome/Chromium/Edge was not found; vision_html_screenshot is unavailable' }
                    : { status: 'ok', detail: chromePath };
            }
            catch {
                if (operation.signal.aborted)
                    throw new VisionToolkitError('cancelled', 'vision_toolkit_health: cancelled');
                chrome = { status: 'error', detail: 'Chrome availability probe failed' };
            }
            let resolvedCredential;
            let credential;
            try {
                resolvedCredential = isBuiltInFreeVisionProvider(this.config.provider)
                    ? { value: BUILT_IN_FREE_VISION_KEY, source: 'built-in' }
                    : await this.ctx.credentials.resolve(this.config.provider.credential);
                credential = resolvedCredential === undefined
                    ? { status: 'error', detail: `credential ${this.config.provider.credential} is not configured` }
                    : { status: 'ok', detail: `credential ${this.config.provider.credential} is resolvable` };
            }
            catch {
                credential = { status: 'error', detail: `credential ${this.config.provider.credential} could not be resolved` };
            }
            let artifactDirectory;
            try {
                // allowedDirs are session input roots; they do not affect output readiness.
                const policy = await createPathPolicy(options.workspace, []);
                artifactDirectory = await this.writableDirectoryCheck(policy.outputDir, 'Artifact directory');
            }
            catch {
                artifactDirectory = { status: 'error', detail: 'Artifact directory could not be prepared' };
            }
            const tempDirectory = await this.writableDirectoryCheck(info.runtimeHome, 'Runtime temp directory');
            let service = {
                status: 'not_tested',
                detail: 'Connection was not tested; pass testConnection=true to query the configured /models endpoint',
            };
            let model = {
                status: 'not_tested',
                detail: 'Vision model was not tested; run an explicit model test to send the bundled diagnostic image',
            };
            if (testConnection) {
                if (resolvedCredential === undefined) {
                    service = { status: 'error', detail: 'Connection test skipped because the configured credential is unavailable' };
                }
                else {
                    operation.metrics.usedVisionService = true;
                    const endpoint = `${this.config.provider.baseUrl}/models`;
                    try {
                        const started = Date.now();
                        const headers = {
                            Accept: 'application/json',
                            'User-Agent': this.config.provider.userAgent,
                        };
                        if (this.config.provider.protocol === 'anthropic') {
                            headers['x-api-key'] = resolvedCredential.value;
                            headers['anthropic-version'] = '2023-06-01';
                        }
                        else {
                            headers.Authorization = `Bearer ${resolvedCredential.value}`;
                        }
                        const response = await fetch(endpoint, {
                            method: 'GET',
                            headers,
                            signal: operation.signal,
                        });
                        operation.metrics.upstreamMs += Date.now() - started;
                        await response.body?.cancel().catch(() => { });
                        if (response.ok) {
                            service = { status: 'ok', detail: `Service responded at ${endpoint} (HTTP ${response.status})` };
                        }
                        else if (response.status === 401) {
                            service = { status: 'error', detail: `Service rejected the configured credential (HTTP ${response.status})` };
                        }
                        else if (response.status === 403) {
                            // Some providers (e.g. Groq preview/account restrictions) block GET /models
                            // while real multimodal requests still work. Treat 403 as a warning so the
                            // explicit vision-model test, not the model list endpoint, decides access.
                            service = { status: 'warning', detail: `Service is reachable but restricted GET /models (HTTP 403); the credential may still be valid for real vision requests` };
                        }
                        else if (response.status === 404 || response.status === 405) {
                            service = { status: 'warning', detail: `Service is reachable but does not expose GET /models (HTTP ${response.status})` };
                        }
                        else if (response.status === 429) {
                            service = { status: 'warning', detail: 'Service is reachable but rate-limited the connection test (HTTP 429)' };
                        }
                        else {
                            service = { status: 'error', detail: `Service connection test failed with HTTP ${response.status}` };
                        }
                    }
                    catch {
                        if (operation.signal.aborted)
                            throw new VisionToolkitError('cancelled', 'vision_toolkit_health: connection test cancelled');
                        service = { status: 'error', detail: `Service could not be reached at ${endpoint}` };
                    }
                }
            }
            if (testModel) {
                if (resolvedCredential === undefined) {
                    model = { status: 'error', detail: 'Vision model test skipped because the configured credential is unavailable' };
                }
                else {
                    try {
                        const result = await this.runUpstream('glance', [VISION_MODEL_TEST_IMAGE, '-q', VISION_MODEL_TEST_PROMPT], operation, this.visionEnv(resolvedCredential));
                        if (result.stdout.trim().length === 0) {
                            throw new VisionToolkitError('output', 'glance: vision API returned an empty description');
                        }
                        model = {
                            status: 'ok',
                            detail: `Vision model ${this.config.provider.model} completed a multimodal request`,
                        };
                    }
                    catch (error) {
                        if (operation.signal.aborted)
                            throw error;
                        const detail = error instanceof Error ? error.message : String(error);
                        model = { status: 'error', detail: `Vision model test failed: ${detail.slice(0, 600)}` };
                    }
                }
            }
            const checks = { python, dependencies, chrome, credential, artifactDirectory, tempDirectory, service, model };
            const healthy = Object.values(checks).every(check => check.status !== 'error');
            return {
                pluginVersion: PLUGIN_VERSION,
                upstream: info,
                checks,
                healthy,
                connectionTested: testConnection,
                modelTested: testModel,
            };
        });
    }
    /** Report the packaged upstream snapshot version. */
    checkoutVersion() {
        return this.adapter.readCheckoutVersion();
    }
    /** Prepared Python command. */
    python() {
        return this.adapter.versionInfo.python;
    }
}
//# sourceMappingURL=runtime.js.map