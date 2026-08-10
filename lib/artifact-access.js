/**
 * Capability-gated HTTP delivery for managed Vision Toolkit artifacts.
 * Signed tokens are durable across process restarts, expose no secret, and
 * are accepted only for the exact artifact facts projected into a tool result.
 * @module dsh-vision-toolkit/artifact-access
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { isWithin } from "./paths.js";
import { visionToolkitStateRoot } from "./runtime-install.js";
/** Prefix owned by the plugin's artifact capability route. */
export const ARTIFACT_ROUTE_PREFIX = '/_dsh/vision-toolkit/artifacts';
/** Presentation metadata key reserved by the browser half of this package. */
export const PRESENTATION_META_KEY = '$dshVisionToolkit';
const KEY_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 16 * 1024;
const MIME_BY_EXTENSION = new Map([
    ['.png', { mimeType: 'image/png', kind: 'image' }],
    ['.jpg', { mimeType: 'image/jpeg', kind: 'image' }],
    ['.jpeg', { mimeType: 'image/jpeg', kind: 'image' }],
    ['.gif', { mimeType: 'image/gif', kind: 'image' }],
    ['.webp', { mimeType: 'image/webp', kind: 'image' }],
    ['.svg', { mimeType: 'image/svg+xml', kind: 'svg' }],
    ['.md', { mimeType: 'text/markdown', kind: 'markdown' }],
    ['.json', { mimeType: 'application/json', kind: 'json' }],
]);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isArtifactKind(value) {
    return value === 'image' || value === 'svg' || value === 'markdown' || value === 'json';
}
function artifactFrom(value) {
    if (!isRecord(value))
        return undefined;
    if (typeof value.path !== 'string'
        || typeof value.filename !== 'string'
        || typeof value.mimeType !== 'string'
        || !isArtifactKind(value.kind)
        || typeof value.description !== 'string'
        || typeof value.sourceTool !== 'string'
        || (value.previewIntent !== 'image' && value.previewIntent !== 'svg' && value.previewIntent !== 'text' && value.previewIntent !== 'download')
        || typeof value.bytes !== 'number'
        || !Number.isSafeInteger(value.bytes)
        || value.bytes < 0)
        return undefined;
    return value;
}
function collectArtifacts(value, found, depth = 0) {
    if (depth > 16)
        return;
    const artifact = artifactFrom(value);
    if (artifact !== undefined) {
        found.set(artifact.path, artifact);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value)
            collectArtifacts(entry, found, depth + 1);
        return;
    }
    if (!isRecord(value))
        return;
    for (const entry of Object.values(value))
        collectArtifacts(entry, found, depth + 1);
}
function parsePayload(value) {
    if (!isRecord(value))
        return undefined;
    if (value.v !== 1
        || typeof value.path !== 'string'
        || !isAbsolute(value.path)
        || typeof value.filename !== 'string'
        || basename(value.path) !== value.filename
        || typeof value.mimeType !== 'string'
        || !isArtifactKind(value.kind)
        || typeof value.bytes !== 'number'
        || !Number.isSafeInteger(value.bytes)
        || value.bytes < 0)
        return undefined;
    const expected = MIME_BY_EXTENSION.get(extname(value.path).toLowerCase());
    if (expected === undefined || expected.mimeType !== value.mimeType || expected.kind !== value.kind)
        return undefined;
    return value;
}
function mac(key, payload) {
    return createHmac('sha256', key).update(payload).digest();
}
function safeEqual(left, right) {
    return left.length === right.length && timingSafeEqual(left, right);
}
async function readKey(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile())
        throw new Error('artifact access key is not a regular file');
    const key = await readFile(path);
    if (key.length !== KEY_BYTES)
        throw new Error('artifact access key has an invalid length');
    await chmod(path, 0o600);
    return key;
}
/**
 * Load or atomically create the per-DSH-home signing key.
 * @param root - state root override used by tests; defaults to the plugin cache.
 * @returns the 32-byte signing key.
 */
export async function prepareArtifactAccessKey(root = visionToolkitStateRoot()) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = join(root, 'artifact-access.key');
    try {
        return await readKey(path);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    const candidate = randomBytes(KEY_BYTES);
    try {
        await writeFile(path, candidate, { flag: 'wx', mode: 0o600 });
        return candidate;
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
        return readKey(path);
    }
}
function artifactRoot(path) {
    let current = dirname(path);
    while (true) {
        if (basename(current) === 'artifacts' && basename(dirname(current)) === '.dsh-vision-toolkit')
            return current;
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
async function assertNoSymlinkPath(root, path) {
    const rootInfo = await lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
        throw new Error('artifact root is not a real directory');
    const rel = relative(root, path);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error('artifact path escaped its managed root');
    }
    let current = root;
    const parts = rel.split(sep);
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (part === undefined || part.length === 0 || part === '.' || part === '..')
            throw new Error('artifact path is malformed');
        current = join(current, part);
        const info = await lstat(current);
        if (info.isSymbolicLink())
            throw new Error('artifact path contains a symbolic link');
        const final = index === parts.length - 1;
        if (final ? !info.isFile() : !info.isDirectory())
            throw new Error('artifact path contains an unexpected entry type');
    }
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path)]);
    if (!isWithin(realRoot, realFile))
        throw new Error('artifact path escaped its managed root');
}
function sameFile(opened, current) {
    if (opened.dev === 0 || current.dev === 0 || opened.ino === 0 || current.ino === 0)
        return true;
    return opened.dev === current.dev && opened.ino === current.ino;
}
async function openVerifiedArtifact(payload) {
    const root = artifactRoot(payload.path);
    if (root === undefined)
        throw new Error('artifact path is outside the managed delivery tree');
    await assertNoSymlinkPath(root, payload.path);
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
    const handle = await open(payload.path, fsConstants.O_RDONLY | noFollow);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size !== payload.bytes)
            throw new Error('artifact no longer matches its delivered descriptor');
        const current = await lstat(payload.path);
        if (current.isSymbolicLink() || !current.isFile() || !sameFile(info, current)) {
            throw new Error('artifact changed while it was being opened');
        }
        await assertNoSymlinkPath(root, payload.path);
        return { handle, info };
    }
    catch (error) {
        await handle.close().catch(() => { });
        throw error;
    }
}
function asciiFilename(filename) {
    const fallback = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160);
    return fallback.length === 0 ? 'artifact' : fallback;
}
function contentDisposition(filename, download) {
    const mode = download ? 'attachment' : 'inline';
    return `${mode}; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
function securityHeaders(res, payload, download) {
    res.setHeader('Content-Type', payload.mimeType);
    res.setHeader('Content-Length', String(payload.bytes));
    res.setHeader('Content-Disposition', contentDisposition(payload.filename, download));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', payload.kind === 'svg'
        ? "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"
        : "sandbox; default-src 'none'");
}
/** Signed-capability encoder and safe Artifact route handler. */
export class ArtifactAccessController {
    key;
    routeCount = 0;
    constructor(key) {
        this.key = key;
        if (key.length !== KEY_BYTES)
            throw new TypeError(`artifact access key must be ${KEY_BYTES} bytes`);
    }
    /** Whether at least one HTTP carrier currently owns the route. */
    get routeAvailable() {
        return this.routeCount > 0;
    }
    /** Mark one route attachment; the returned disposer removes that attachment. */
    attachRoute() {
        this.routeCount += 1;
        let active = true;
        return () => {
            if (!active)
                return;
            active = false;
            this.routeCount -= 1;
        };
    }
    /**
     * Purely enrich a canonical tool-result value with browser access grants.
     * @param value - schema-validated tool result.
     * @returns the unchanged value when no route/artifact exists, otherwise a detached metadata envelope.
     */
    presentationMeta(value) {
        if (!this.routeAvailable || !isRecord(value))
            return value;
        const artifacts = new Map();
        collectArtifacts(value, artifacts);
        if (artifacts.size === 0)
            return value;
        const grants = [...artifacts.values()].map((artifact) => {
            const token = this.sign(artifact);
            const previewUrl = `${ARTIFACT_ROUTE_PREFIX}/${token}`;
            return { path: artifact.path, previewUrl, downloadUrl: `${previewUrl}?download=1` };
        });
        const envelope = { schemaVersion: 1, artifacts: grants };
        return { ...value, [PRESENTATION_META_KEY]: envelope };
    }
    /** Mint a deterministic, tamper-evident capability for one descriptor. */
    sign(artifact) {
        const payload = {
            v: 1,
            path: artifact.path,
            filename: artifact.filename,
            mimeType: artifact.mimeType,
            kind: artifact.kind,
            bytes: artifact.bytes,
        };
        const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
        return `${encoded}.${mac(this.key, encoded).toString('base64url')}`;
    }
    /** Verify and decode one capability without touching the filesystem. */
    verify(token) {
        if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token))
            return undefined;
        const [encoded, signature] = token.split('.');
        if (encoded === undefined || signature === undefined)
            return undefined;
        let supplied;
        try {
            supplied = Buffer.from(signature, 'base64url');
        }
        catch {
            return undefined;
        }
        if (!safeEqual(mac(this.key, encoded), supplied))
            return undefined;
        try {
            return parsePayload(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
        }
        catch {
            return undefined;
        }
    }
    /**
     * Serve one GET/HEAD capability request with MIME, CSP, and symlink checks.
     * @param req - Node HTTP request matched under {@link ARTIFACT_ROUTE_PREFIX}.
     * @param res - response owned by this handler.
     */
    async handle(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.setHeader('Allow', 'GET, HEAD');
            res.writeHead(405);
            res.end();
            return;
        }
        let url;
        try {
            url = new URL(req.url ?? '/', 'http://dsh.local');
        }
        catch {
            res.writeHead(400);
            res.end();
            return;
        }
        const prefix = `${ARTIFACT_ROUTE_PREFIX}/`;
        if (!url.pathname.startsWith(prefix) || url.pathname.slice(prefix.length).includes('/')) {
            res.writeHead(404);
            res.end();
            return;
        }
        let token;
        try {
            token = decodeURIComponent(url.pathname.slice(prefix.length));
        }
        catch {
            res.writeHead(404);
            res.end();
            return;
        }
        const payload = this.verify(token);
        if (payload === undefined) {
            res.writeHead(404);
            res.end();
            return;
        }
        const downloadValue = url.searchParams.get('download');
        if ([...url.searchParams.keys()].some(key => key !== 'download') || (downloadValue !== null && downloadValue !== '1')) {
            res.writeHead(400);
            res.end();
            return;
        }
        let opened;
        try {
            opened = await openVerifiedArtifact(payload);
        }
        catch {
            res.writeHead(404);
            res.end();
            return;
        }
        securityHeaders(res, payload, downloadValue === '1');
        res.writeHead(200);
        if (req.method === 'HEAD') {
            await opened.handle.close().catch(() => { });
            res.end();
            return;
        }
        const stream = opened.handle.createReadStream({ autoClose: true });
        stream.on('error', () => {
            if (!res.headersSent)
                res.writeHead(500);
            res.destroy();
        });
        stream.pipe(res);
    }
}
//# sourceMappingURL=artifact-access.js.map