/** Workspace-local storage for images pasted into the DSH Web composer. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sameOriginPost } from "./web-request.js";
/** Exact route used by the browser paste integration. */
export const PASTE_IMAGES_ROUTE = '/_dsh/vision-toolkit/paste-images';
/**
 * Exact route the browser paste integration asks before taking a paste over:
 * `GET ?sessionId=&model=&provider=&modelId=` answers the verdict from the
 * live Session's model route.
 */
export const PASTE_POLICY_ROUTE = '/_dsh/vision-toolkit/paste-policy';
const MAX_NAME_BYTES = 180;
/**
 * Hard per-image upload ceiling for pastes. Files between the configured
 * `maxImageBytes` (default 4 MiB) and this ceiling are stored as-is and
 * auto-compressed by the runtime on first use; matching the browser-side
 * safety cap keeps the two bundles in agreement.
 */
export const MAX_PASTE_IMAGE_BYTES = 20 * 1024 * 1024;
function responseJson(res, status, body) {
    const bytes = Buffer.from(JSON.stringify(body));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.writeHead(status);
    res.end(bytes);
}
function requestError(res, status, code, message) {
    responseJson(res, status, { ok: false, error: { code, message } });
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
function singleQuery(url, key) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1 || values[0] === undefined || values[0] === '') {
        throw new TypeError(`${key} is required exactly once`);
    }
    return values[0];
}
function declaredSize(url) {
    const value = Number(singleQuery(url, 'size'));
    if (!Number.isSafeInteger(value) || value < 1)
        throw new TypeError('size must be a positive safe integer');
    return value;
}
function imageMediaType(req) {
    const value = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (value === undefined || !value.startsWith('image/'))
        throw new TypeError('Content-Type must be image/*');
    return value;
}
function extensionFor(mediaType) {
    switch (mediaType) {
        case 'image/jpeg': return '.jpg';
        case 'image/png': return '.png';
        case 'image/gif': return '.gif';
        case 'image/webp': return '.webp';
        case 'image/bmp': return '.bmp';
        case 'image/tiff': return '.tiff';
        case 'image/avif': return '.avif';
        case 'image/heic': return '.heic';
        case 'image/heif': return '.heif';
        case 'image/svg+xml': return '.svg';
        default: return '.img';
    }
}
/** Convert an untrusted browser label into one portable leaf filename. */
export function safePastedImageName(raw, mediaType) {
    const leaf = basename(raw.replaceAll('\\', '/')).normalize('NFC');
    let cleaned = leaf
        .replace(/[<>:"|?*\u0000-\u001f/\\]/gu, '_')
        .replace(/\s+/gu, ' ')
        .replace(/^\.+/u, '')
        .trim()
        .replace(/[. ]+$/u, '');
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(cleaned))
        cleaned = `_${cleaned}`;
    const fallback = `clipboard-image${extensionFor(mediaType)}`;
    const candidate = cleaned === '' || cleaned === '.' || cleaned === '..' ? fallback : cleaned;
    if (Buffer.byteLength(candidate) <= MAX_NAME_BYTES)
        return candidate;
    const extension = extname(candidate).slice(0, 20);
    const budget = Math.max(1, MAX_NAME_BYTES - Buffer.byteLength(extension));
    let stem = candidate.slice(0, Math.max(1, candidate.length - extension.length));
    while (Buffer.byteLength(stem) > budget)
        stem = stem.slice(0, -1);
    return `${stem}${extension}`;
}
/** Reject a resolved path that is not rooted below the expected directory. */
export function ensurePathInside(root, target) {
    const rel = relative(root, target);
    if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
        throw new Error(`resolved pasted-image path escapes its workspace root: ${target}`);
    }
}
async function ensureManagedDirectory(workspace, path) {
    try {
        await mkdir(path, { mode: 0o700 });
    }
    catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST'))
            throw error;
    }
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) {
        throw new Error(`resolved pasted-image path escapes its workspace root: symbolic link ${path}`);
    }
    if (!entry.isDirectory())
        throw new Error(`pasted-image path is not a directory: ${path}`);
    const canonical = await realpath(path);
    ensurePathInside(workspace, canonical);
    return canonical;
}
/**
 * Resolve the managed per-session image directory used by both browser pastes
 * and native attachment bridging. Keeping both flows under the same workspace
 * root makes the resulting absolute path valid for the model's visual tools.
 */
export async function sessionPasteRoot(ctx, sessionId) {
    const session = ctx.sessions.get(sessionId);
    if (session === undefined)
        throw new Error(`live Session not found: ${sessionId}`);
    const cwd = session.header.cwd;
    if (cwd === undefined || !isAbsolute(cwd))
        throw new Error(`Session has no absolute workspace: ${sessionId}`);
    const visibleWorkspace = resolve(cwd);
    const workspace = await realpath(visibleWorkspace);
    const pluginRoot = join(visibleWorkspace, '.dsh-vision-toolkit');
    await ensureManagedDirectory(workspace, pluginRoot);
    const temporaryRoot = join(pluginRoot, 'tmp');
    await ensureManagedDirectory(workspace, temporaryRoot);
    const requestedRoot = join(temporaryRoot, 'pasted-images');
    const root = await ensureManagedDirectory(workspace, requestedRoot);
    const sessionKey = createHash('sha256').update(sessionId).digest('hex').slice(0, 20);
    const requestedSessionRoot = join(requestedRoot, sessionKey);
    const sessionRoot = await ensureManagedDirectory(root, requestedSessionRoot);
    ensurePathInside(root, sessionRoot);
    return { writeRoot: sessionRoot, visibleRoot: requestedSessionRoot };
}
async function writeImage(req, directory, filename, expectedBytes, maxBytes) {
    if (expectedBytes > maxBytes)
        throw new RangeError(`image exceeds the ${maxBytes}-byte paste limit`);
    const id = randomUUID();
    const finalPath = join(directory, `${id}-${filename}`);
    const stagingPath = join(directory, `.${id}.partial`);
    ensurePathInside(directory, finalPath);
    ensurePathInside(directory, stagingPath);
    const handle = await open(stagingPath, 'wx', 0o600);
    let received = 0;
    try {
        for await (const chunk of req) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            received += bytes.length;
            if (received > expectedBytes || received > maxBytes)
                throw new RangeError('pasted image body exceeds its declared size');
            await handle.write(bytes);
        }
        if (received !== expectedBytes) {
            throw new Error(`pasted image body size mismatch: expected ${expectedBytes}, received ${received}`);
        }
        await handle.sync();
        await handle.close();
        await rename(stagingPath, finalPath);
        return finalPath;
    }
    catch (error) {
        await handle.close().catch(() => { });
        await rm(stagingPath, { force: true }).catch(() => { });
        throw error;
    }
}
/** Same-origin, live-Session-bound image upload endpoint. */
export class PastedImageBackend {
    ctx;
    runtime;
    constructor(ctx, runtime) {
        this.ctx = ctx;
        this.runtime = runtime;
    }
    async handle(req, res) {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            requestError(res, 405, 'method-not-allowed', 'Use POST');
            return;
        }
        if (!sameOriginPost(req)) {
            requestError(res, 403, 'origin-rejected', 'The request must originate from this DSH Web application');
            return;
        }
        try {
            const url = new URL(req.url ?? PASTE_IMAGES_ROUTE, 'http://dsh.internal');
            const sessionId = singleQuery(url, 'sessionId');
            const size = declaredSize(url);
            const mediaType = imageMediaType(req);
            const filename = safePastedImageName(singleQuery(url, 'name'), mediaType);
            const contentLength = req.headers['content-length'];
            if (contentLength !== undefined && Number(contentLength) !== size) {
                throw new TypeError('Content-Length does not match the declared size');
            }
            const directory = await sessionPasteRoot(this.ctx, sessionId);
            const writtenPath = await writeImage(req, directory.writeRoot, filename, size, this.runtime.maxUploadBytes());
            const absolutePath = join(directory.visibleRoot, basename(writtenPath));
            responseJson(res, 201, { ok: true, value: { absolutePath, filename, bytes: size } });
        }
        catch (error) {
            const status = error instanceof RangeError ? 413 : 400;
            this.ctx.logger.warn('dsh-vision-toolkit pasted image rejected: %s', message(error));
            requestError(res, status, 'paste-image-rejected', message(error));
        }
    }
}
//# sourceMappingURL=paste-images.js.map