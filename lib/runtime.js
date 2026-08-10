/**
 * Vision Toolkit runtime: structured requests in, structured results out.
 * One operation-wide deadline reaches every subprocess; image decoding,
 * byte/pixel limits, session-scoped concurrency, credential resolution, safe
 * output staging, and diagnostic logging stay below the model-facing tools.
 * @module dsh-vision-toolkit/runtime
 */
import { readFile, rm } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { VisionToolkitError } from "./errors.js";
import { assertDistinctOutput, commitStagedOutput, createPathPolicy, createStagedOutput, resolveInputFile, resolveOutputFile, } from "./paths.js";
import { parseCropOutput, parseLocationOutput, parseTraceOutput, UpstreamAdapter, } from "./upstream.js";
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
    async acquire(signal) {
        if (signal.aborted)
            throw new VisionToolkitError('cancelled', 'vision-toolkit: cancelled before execution');
        if (this.active < this.limit) {
            this.active += 1;
            return;
        }
        return new Promise((resolveAcquire, reject) => {
            const entry = {
                resolve: resolveAcquire,
                reject,
                signal,
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
    /** Release one slot and transfer it directly to the longest-waiting caller. */
    release() {
        const next = this.waiters.shift();
        if (next !== undefined) {
            next.signal.removeEventListener('abort', next.onAbort);
            next.resolve();
            return;
        }
        this.active = Math.max(0, this.active - 1);
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
    operationError(tool, error, deadline) {
        if (deadline.cancelled)
            return new VisionToolkitError('cancelled', `${tool}: cancelled`);
        if (deadline.timedOut)
            return new VisionToolkitError('timeout', `${tool}: timed out`);
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
    async runOperation(tool, options, action) {
        const deadline = createDeadline(options.signal, this.timeout(options));
        const semaphore = this.semaphore(options);
        const metrics = {
            startedAt: Date.now(),
            upstreamMs: 0,
            imageBytes: 0,
            imagePixels: 0,
            imageCount: 0,
            cacheHits: 0,
        };
        let acquired = false;
        try {
            await semaphore.value.acquire(deadline.signal);
            acquired = true;
            const value = await action({ signal: deadline.signal, metrics });
            if (deadline.signal.aborted)
                throw this.operationError(tool, undefined, deadline);
            this.ctx.logger.info('dsh-vision-toolkit tool=%s outcome=ok totalMs=%d upstreamMs=%d images=%d imageBytes=%d imagePixels=%d cacheHits=%d model=%s', tool, Date.now() - metrics.startedAt, metrics.upstreamMs, metrics.imageCount, metrics.imageBytes, metrics.imagePixels, metrics.cacheHits, tool === 'vision_glance' || tool === 'vision_ground' || tool === 'vision_detect'
                ? this.config.provider.model
                : 'local');
            return value;
        }
        catch (error) {
            const classified = this.operationError(tool, error, deadline);
            this.ctx.logger.warn('dsh-vision-toolkit tool=%s outcome=error category=%s totalMs=%d upstreamMs=%d images=%d imageBytes=%d imagePixels=%d cacheHits=%d', tool, classified.code, Date.now() - metrics.startedAt, metrics.upstreamMs, metrics.imageCount, metrics.imageBytes, metrics.imagePixels, metrics.cacheHits);
            throw classified;
        }
        finally {
            if (acquired)
                semaphore.value.release();
            deadline.cleanup();
            if (semaphore.value.idle)
                this.semaphores.delete(semaphore.key);
        }
    }
    /** Resolve the configured credential at the remote-operation boundary. */
    async resolveVisionEnv() {
        const resolved = await this.ctx.credentials.resolve(this.config.provider.credential);
        if (resolved === undefined) {
            throw new VisionToolkitError('config', `credential ${this.config.provider.credential} is not configured; set it through DSH credentials`);
        }
        return {
            VISION_API_KEY: resolved.value,
            VISION_BASE_URL: this.config.provider.baseUrl,
            VISION_MODEL: this.config.provider.model,
            LANG: this.config.language,
        };
    }
    pathPolicy(workspace) {
        return createPathPolicy(workspace, this.config.allowedDirs);
    }
    async validateImage(raw, policy, operation) {
        const image = await resolveInputFile(raw, policy);
        if (image.bytes > this.config.maxImageBytes) {
            throw new VisionToolkitError('capacity', `image is ${image.bytes} bytes, exceeding maxImageBytes ${this.config.maxImageBytes}`);
        }
        const decoded = await this.adapter.probeImageSize(image.path, { signal: operation.signal });
        const pixels = decoded.width * decoded.height;
        if (!Number.isSafeInteger(pixels) || pixels > this.config.maxImagePixels) {
            throw new VisionToolkitError('capacity', `image is ${decoded.width}x${decoded.height} (${pixels} pixels), exceeding maxImagePixels ${this.config.maxImagePixels}`);
        }
        const extension = extname(image.path).toLowerCase();
        const expected = FORMAT_BY_EXTENSION.get(extension);
        if (expected !== decoded.format) {
            throw new VisionToolkitError('input', `image content is ${decoded.format}, but the filename uses ${extension}`);
        }
        return { ...image, ...decoded };
    }
    accountImage(image, operation) {
        operation.metrics.imageCount += 1;
        operation.metrics.imageBytes += image.bytes;
        operation.metrics.imagePixels += image.width * image.height;
    }
    async runUpstream(tool, args, operation, env) {
        const started = Date.now();
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
            const result = await this.runUpstream('glance', [
                ...images.map(image => image.path),
                ...(request.region !== undefined ? ['--region', request.region] : []),
                ...(request.ocr === true ? ['--ocr'] : []),
                ...(request.query !== undefined ? ['-q', request.query] : []),
            ], operation, env);
            const answer = result.stdout.trim();
            if (answer.length === 0)
                throw new VisionToolkitError('output', 'glance: vision API returned an empty description');
            return {
                images,
                mode: request.ocr === true ? 'ocr' : request.query !== undefined ? 'qa' : 'describe',
                answer,
                truncated: false,
            };
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
            return {
                target: request.target,
                imageWidth: image.width,
                imageHeight: image.height,
                matches: elements.map(element => ({ label: element.label ?? request.target, box: element.box })),
            };
        });
    }
    /** detect: inventory every instance of a kind. */
    async detect(request, options) {
        return this.runOperation('vision_detect', options, async (operation) => {
            const { image, elements } = await this.locate(request, options, operation, 'detect');
            return {
                category: request.target,
                imageWidth: image.width,
                imageHeight: image.height,
                elements: elements.map((element, index) => ({
                    index: index + 1,
                    label: element.label ?? request.target,
                    box: element.box,
                })),
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
            const sourceExtension = extname(image.path).toLowerCase();
            const stem = basename(image.path, sourceExtension);
            const finalPath = resolveOutputFile(request.output, policy, request.scale !== undefined && request.scale > 1 ? `${stem}.crop@${request.scale}x.png` : `${stem}.crop.png`, ['.png', '.jpg', '.jpeg']);
            assertDistinctOutput(image.path, finalPath);
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
                await commitStagedOutput(staged, finalPath, policy);
                return {
                    imageWidth: image.width,
                    imageHeight: image.height,
                    region,
                    outputPath: finalPath,
                    mimeType: outputExtension === '.png' ? 'image/png' : 'image/jpeg',
                    width: parsed.width,
                    height: parsed.height,
                    clamped: parsed.clamped,
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
            const extension = extname(image.path).toLowerCase();
            const stem = basename(image.path, extension);
            const finalPath = resolveOutputFile(request.output, policy, `${stem}.svg`, ['.svg']);
            assertDistinctOutput(image.path, finalPath);
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
                if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/i.test(svg)) {
                    throw new VisionToolkitError('output', 'trace: output SVG is not a parseable document');
                }
                const actualPathCount = (svg.match(/<path\b/gi) ?? []).length;
                if (actualPathCount !== parsed.pathCount) {
                    throw new VisionToolkitError('output', 'trace: reported path count does not match the generated SVG');
                }
                await commitStagedOutput(staged, finalPath, policy);
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
                    ...(warning.length === 0 ? {} : { warning: warning.split(/\r?\n/).slice(-1)[0] ?? warning }),
                };
            }
            finally {
                await rm(staged, { force: true }).catch(() => { });
            }
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