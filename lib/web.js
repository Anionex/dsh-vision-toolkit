/**
 * Optional Web-profile routes: signed Artifact delivery plus a same-origin
 * Settings/health endpoint. The browser never receives credential values and
 * connection tests run only after an explicit POST action.
 * @module dsh-vision-toolkit/web
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { SettingsConflictError } from '@deepseek-ai/dsh-settings';
import { ARTIFACT_ROUTE_PREFIX } from "./artifact-access.js";
import { PASTE_IMAGES_ROUTE } from "./paste-images.js";
import { resolveConfig, VISION_TOOLKIT_SETTINGS_NAMESPACE, } from "./config.js";
import { PLUGIN_VERSION, UPSTREAM_COMMIT, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from "./version.js";
import { sameOriginPost } from "./web-request.js";
/** Exact route used by the browser Settings page. */
export const SETTINGS_ROUTE = '/_dsh/vision-toolkit/settings';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function descriptorOf(ctx) {
    const descriptor = ctx.settings.describe().find(row => row.ns === VISION_TOOLKIT_SETTINGS_NAMESPACE);
    if (descriptor === undefined)
        throw new Error('vision-toolkit Settings namespace is not registered');
    return descriptor;
}
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
async function readJson(req, maxBytes = 64 * 1024) {
    const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json')
        throw new TypeError('Content-Type must be application/json');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += part.length;
        if (bytes > maxBytes)
            throw new RangeError(`request body exceeds ${maxBytes} bytes`);
        chunks.push(part);
    }
    if (chunks.length === 0)
        throw new TypeError('request body is empty');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function parseRequest(value) {
    if (!isRecord(value) || typeof value.action !== 'string')
        throw new TypeError('request action is required');
    if (value.action === 'health') {
        if (typeof value.testConnection !== 'boolean')
            throw new TypeError('health.testConnection must be boolean');
        return { action: 'health', testConnection: value.testConnection };
    }
    if (value.action === 'save') {
        if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) {
            throw new TypeError('save.expectedRevision must be a non-negative integer');
        }
        if (!isRecord(value.value))
            throw new TypeError('save.value must be an object');
        return {
            action: 'save',
            expectedRevision: value.expectedRevision,
            value: value.value,
        };
    }
    throw new TypeError(`unsupported action: ${value.action}`);
}
function publicMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/** Same-origin Settings and health handler. */
export class VisionToolkitWebBackend {
    ctx;
    manager;
    artifacts;
    onRuntimeActivated;
    constructor(ctx, manager, artifacts, onRuntimeActivated) {
        this.ctx = ctx;
        this.manager = manager;
        this.artifacts = artifacts;
        this.onRuntimeActivated = onRuntimeActivated;
    }
    async credential(config) {
        return this.ctx.credentials.describe(credentialRef(String(config.provider.credential)));
    }
    /** Build the current settings/runtime/credential snapshot without secrets. */
    async snapshot() {
        const descriptor = descriptorOf(this.ctx);
        const value = descriptor.value;
        const resolved = resolveConfig(value);
        const credential = await this.credential(resolved);
        return {
            schemaVersion: 1,
            writable: this.ctx.settings.writable,
            settings: {
                value,
                ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
                ...(descriptor.base === undefined ? {} : { base: descriptor.base }),
                revision: descriptor.revision,
                applies: 'live',
            },
            credential: {
                ref: String(resolved.provider.credential),
                configured: credential.configured,
                ...(credential.source === undefined ? {} : { source: credential.source }),
                writable: credential.writable,
            },
            runtime: this.manager.status(),
            release: {
                pluginVersion: PLUGIN_VERSION,
                upstreamRepository: UPSTREAM_REPOSITORY,
                upstreamVersion: UPSTREAM_VERSION,
                upstreamCommit: UPSTREAM_COMMIT,
            },
            artifactRouteAvailable: this.artifacts.routeAvailable,
        };
    }
    async save(request) {
        if (!this.ctx.settings.writable)
            throw new Error('settings provider is read-only');
        let candidate;
        try {
            candidate = await this.manager.prepareCandidate(request.value);
        }
        catch (error) {
            this.manager.recordFailure(error);
            throw error;
        }
        await this.ctx.settings.replace(VISION_TOOLKIT_SETTINGS_NAMESPACE, request.value, request.expectedRevision);
        this.manager.activateCandidate(candidate);
        this.onRuntimeActivated();
        return this.snapshot();
    }
    async health(request, req) {
        if (!this.manager.ready)
            throw new Error('runtime is not ready; fix Settings and save a valid configuration first');
        const controller = new AbortController();
        const abort = () => { controller.abort(); };
        req.once('aborted', abort);
        req.socket.once('close', abort);
        try {
            return await this.manager.current().health(request.testConnection, {
                signal: controller.signal,
                workspace: process.cwd(),
                sessionId: 'vision-toolkit-settings',
            });
        }
        finally {
            req.off('aborted', abort);
            req.socket.off('close', abort);
        }
    }
    /** Handle the exact Settings route. */
    async handle(req, res) {
        if (req.method === 'GET') {
            try {
                responseJson(res, 200, { ok: true, value: await this.snapshot() });
            }
            catch (error) {
                this.ctx.logger.warn('dsh-vision-toolkit Settings snapshot failed: %s', publicMessage(error));
                requestError(res, 503, 'settings-unavailable', 'Vision Toolkit Settings are unavailable');
            }
            return;
        }
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            requestError(res, 405, 'method-not-allowed', 'Use GET or POST');
            return;
        }
        if (!sameOriginPost(req)) {
            requestError(res, 403, 'origin-rejected', 'The request must originate from this DSH Web application');
            return;
        }
        let parsed;
        try {
            parsed = parseRequest(await readJson(req));
        }
        catch (error) {
            requestError(res, error instanceof RangeError ? 413 : 400, 'invalid-request', publicMessage(error));
            return;
        }
        try {
            if (parsed.action === 'health') {
                responseJson(res, 200, { ok: true, value: await this.health(parsed, req) });
            }
            else {
                responseJson(res, 200, { ok: true, value: await this.save(parsed) });
            }
        }
        catch (error) {
            const conflict = error instanceof SettingsConflictError;
            const code = conflict ? 'settings-conflict' : parsed.action === 'health' ? 'health-failed' : 'settings-rejected';
            const status = conflict ? 409 : parsed.action === 'health' ? 503 : 400;
            this.ctx.logger.warn('dsh-vision-toolkit Web action=%s failed: %s', parsed.action, publicMessage(error));
            requestError(res, status, code, publicMessage(error));
        }
    }
}
/**
 * Attach optional Web routes through either published DSH HTTP service name.
 * @param ctx - plugin context owning route effects.
 * @param backend - Settings handler.
 * @param artifacts - signed Artifact handler.
 */
export function installVisionToolkitWeb(ctx, backend, artifacts, pastedImages) {
    const install = (serviceName) => {
        ctx.inject([serviceName], (candidate) => {
            const webCtx = candidate;
            webCtx.effect(() => {
                const server = webCtx[serviceName];
                const detach = artifacts.attachRoute();
                const disposeArtifact = server.register({
                    kind: 'prefix',
                    path: ARTIFACT_ROUTE_PREFIX,
                    handler: (req, res) => artifacts.handle(req, res),
                });
                const disposeSettings = server.register({
                    kind: 'exact',
                    path: SETTINGS_ROUTE,
                    handler: (req, res) => backend.handle(req, res),
                });
                const disposePasteImages = server.register({
                    kind: 'exact',
                    path: PASTE_IMAGES_ROUTE,
                    handler: (req, res) => pastedImages.handle(req, res),
                });
                return () => {
                    disposePasteImages();
                    disposeSettings();
                    disposeArtifact();
                    detach();
                };
            }, `dsh-vision-toolkit: Web routes (${serviceName})`);
        });
    };
    install('httpServer');
    install('webServer');
}
//# sourceMappingURL=web.js.map