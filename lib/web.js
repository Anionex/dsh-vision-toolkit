/**
 * Optional Web-profile routes: signed Artifact delivery plus a same-origin
 * Settings/health endpoint. The browser never receives credential values and
 * connection tests run only after an explicit POST action.
 * @module dsh-vision-toolkit/web
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { SettingsConflictError } from '@deepseek-ai/dsh-settings';
import { ARTIFACT_ROUTE_PREFIX } from "./artifact-access.js";
import { PASTE_IMAGES_ROUTE, PASTE_POLICY_ROUTE, } from "./paste-images.js";
import { resolveConfig, isBuiltInFreeVisionProvider, VISION_TOOLKIT_SETTINGS_NAMESPACE, } from "./config.js";
import { PluginUpdateError, VisionToolkitPluginUpdateService, } from "./plugin-update.js";
import { PLUGIN_VERSION, UPSTREAM_COMMIT, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from "./version.js";
import { sameOriginPost, sameOriginRequest } from "./web-request.js";
/** Exact route used by the browser Settings page. */
export const SETTINGS_ROUTE = '/_dsh/vision-toolkit/settings';
/** Same-origin route used by the browser client to read display-mode flags. */
export const DISPLAY_CONFIG_ROUTE = '/_dsh/vision-toolkit/display-config';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
class CredentialReferenceConflictError extends Error {
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
        const testModel = value.testModel === undefined ? false : value.testModel;
        if (typeof testModel !== 'boolean')
            throw new TypeError('health.testModel must be boolean');
        if (testModel && !value.testConnection)
            throw new TypeError('health.testModel requires health.testConnection');
        return { action: 'health', testConnection: value.testConnection, testModel };
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
    if (value.action === 'credential') {
        if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) {
            throw new TypeError('credential.expectedRevision must be a non-negative integer');
        }
        if (typeof value.ref !== 'string')
            throw new TypeError('credential.ref must be a string');
        if (typeof value.value !== 'string')
            throw new TypeError('credential.value must be a string');
        const secret = value.value.trim();
        if (secret.length === 0)
            throw new TypeError('API key cannot be blank');
        const first = secret[0];
        const quoted = secret.length > 1 && (first === '"' || first === '\'' || first === '`') && secret.endsWith(first);
        const environmentLine = /^[A-Z][A-Z0-9_]*=[^=]/u.test(secret);
        if (quoted || environmentLine || !/^[\x21-\x7E]+$/u.test(secret)) {
            throw new TypeError('paste only the API key, without a variable name, quotes, spaces, or line breaks');
        }
        return {
            action: 'credential',
            expectedRevision: value.expectedRevision,
            ref: credentialRef(value.ref),
            value: secret,
        };
    }
    if (value.action === 'check-update')
        return { action: 'check-update' };
    if (value.action === 'apply-update') {
        if (typeof value.expectedVersion !== 'string' || value.expectedVersion.trim().length === 0) {
            throw new TypeError('apply-update.expectedVersion must be a non-empty string');
        }
        return { action: 'apply-update', expectedVersion: value.expectedVersion.trim() };
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
    updater;
    constructor(ctx, manager, artifacts, onRuntimeActivated, updater) {
        this.ctx = ctx;
        this.manager = manager;
        this.artifacts = artifacts;
        this.onRuntimeActivated = onRuntimeActivated;
        this.updater = updater ?? new VisionToolkitPluginUpdateService(ctx, PLUGIN_VERSION, {
            runtimeReady: () => this.manager.status().ready,
        });
    }
    /** Supply the active listener address before the Settings route becomes reachable. */
    configureWebServer(host, port) {
        this.updater.configureWebServer?.(host, port);
    }
    async credential(config) {
        if (isBuiltInFreeVisionProvider(config.provider)) {
            return { configured: true, source: 'built-in-free', writable: false };
        }
        return this.ctx.credentials.describe(credentialRef(String(config.provider.credential)));
    }
    /** Build the current settings/runtime/credential snapshot without secrets. */
    async snapshot() {
        const descriptor = descriptorOf(this.ctx);
        const value = descriptor.value;
        const resolved = resolveConfig(value);
        const credential = await this.credential(resolved);
        const update = await this.updater.capability();
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
                update,
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
    async saveCredential(request) {
        const descriptor = descriptorOf(this.ctx);
        if (descriptor.revision !== request.expectedRevision) {
            throw new SettingsConflictError(VISION_TOOLKIT_SETTINGS_NAMESPACE, request.expectedRevision, descriptor.revision);
        }
        const resolved = resolveConfig(descriptor.value);
        const currentRef = credentialRef(String(resolved.provider.credential));
        if (currentRef !== request.ref) {
            throw new CredentialReferenceConflictError(`credential reference changed from "${request.ref}" to "${currentRef}"; reload Settings and try again`);
        }
        if (isBuiltInFreeVisionProvider(resolved.provider)) {
            throw new Error('The built-in free vision provider does not accept a user API key');
        }
        await this.ctx.credentials.set(currentRef, request.value);
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
            const runtime = this.manager.current();
            // Use the prepared runtime home instead of the host process cwd.
            return await runtime.health(request.testConnection, {
                signal: controller.signal,
                workspace: runtime.upstreamVersion.runtimeHome,
                sessionId: 'vision-toolkit-settings',
            }, request.testModel);
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
            switch (parsed.action) {
                case 'health':
                    responseJson(res, 200, { ok: true, value: await this.health(parsed, req) });
                    break;
                case 'save':
                    responseJson(res, 200, { ok: true, value: await this.save(parsed) });
                    break;
                case 'credential':
                    responseJson(res, 200, { ok: true, value: await this.saveCredential(parsed) });
                    break;
                case 'check-update':
                    responseJson(res, 200, { ok: true, value: await this.updater.check() });
                    break;
                case 'apply-update':
                    responseJson(res, 200, { ok: true, value: await this.updater.installAndRestart(parsed.expectedVersion) });
                    break;
            }
        }
        catch (error) {
            const settingsConflict = error instanceof SettingsConflictError;
            const credentialConflict = error instanceof CredentialReferenceConflictError;
            const updateError = error instanceof PluginUpdateError;
            const code = settingsConflict
                ? 'settings-conflict'
                : credentialConflict
                    ? 'credential-conflict'
                    : updateError
                        ? error.code
                        : parsed.action === 'health'
                            ? 'health-failed'
                            : parsed.action === 'credential'
                                ? 'credential-rejected'
                                : 'settings-rejected';
            const updateConflict = updateError && ['update-in-progress', 'update-stale', 'update-unavailable', 'already-current'].includes(error.code);
            const updateGateway = updateError && error.code === 'update-check-failed';
            const status = settingsConflict || credentialConflict || updateConflict
                ? 409
                : parsed.action === 'health'
                    ? 503
                    : updateGateway
                        ? 502
                        : updateError
                            ? 500
                            : 400;
            this.ctx.logger.warn('dsh-vision-toolkit Web action=%s failed: %s', parsed.action, publicMessage(error));
            requestError(res, status, code, publicMessage(error));
        }
    }
}
/**
 * Same-origin policy handler for the paste route: whether the browser should
 * take a paste over into workspace paths, or let it flow natively after an
 * optional automatic switch to the image-input variant. The optional `model`
 * query carries the model-selector label the client currently shows; the
 * optional `provider`/`modelId`/`reasoningEffort` queries carry the exact
 * route the client read from the live model catalog, which the resolver
 * prefers (a label alone cannot pick a provider). Unresolvable routes answer
 * native — the safe default.
 * @param resolve - resolves one live Session's paste verdict.
 * @returns the HTTP handler.
 */
export function createPastePolicyHandler(resolve) {
    return (req, res) => {
        void (async () => {
            try {
                if (req.method !== 'GET') {
                    requestError(res, 405, 'method-not-allowed', 'Use GET');
                    return;
                }
                if (!sameOriginRequest(req)) {
                    requestError(res, 403, 'origin-rejected', 'The request must originate from this DSH Web application');
                    return;
                }
                let sessionId;
                let modelLabel;
                let selection;
                try {
                    const url = new URL(req.url ?? PASTE_POLICY_ROUTE, 'http://dsh.internal');
                    const sessions = url.searchParams.getAll('sessionId');
                    if (sessions.length !== 1 || sessions[0] === undefined || sessions[0] === '') {
                        throw new TypeError('sessionId is required exactly once');
                    }
                    sessionId = sessions[0];
                    const models = url.searchParams.getAll('model');
                    if (models.length > 1)
                        throw new TypeError('model may be given at most once');
                    modelLabel = models[0];
                    const providers = url.searchParams.getAll('provider');
                    if (providers.length > 1)
                        throw new TypeError('provider may be given at most once');
                    const modelIds = url.searchParams.getAll('modelId');
                    if (modelIds.length > 1)
                        throw new TypeError('modelId may be given at most once');
                    const efforts = url.searchParams.getAll('reasoningEffort');
                    if (efforts.length > 1)
                        throw new TypeError('reasoningEffort may be given at most once');
                    const provider = providers[0];
                    const modelId = modelIds[0];
                    if (provider !== undefined && modelId !== undefined && provider !== '' && modelId !== '') {
                        selection = {
                            provider,
                            model: modelId,
                            ...(efforts[0] === undefined || efforts[0] === '' ? {} : { reasoningEffort: efforts[0] }),
                        };
                    }
                }
                catch (error) {
                    requestError(res, 400, 'invalid-request', publicMessage(error));
                    return;
                }
                const verdict = await resolve(sessionId, selection, modelLabel);
                responseJson(res, 200, { ok: true, value: verdict });
            }
            catch (error) {
                requestError(res, 500, 'policy-failed', publicMessage(error));
            }
        })();
    };
}
/**
 * Same-origin display-config handler: exposes whether transparent routing is
 * active. The paste integration uses it to choose its notice text; the model
 * selector hides upstream twins synchronously from DOM display names and does
 * not depend on this route.
 * @param getDisplayConfig - resolves the current display-mode flags.
 * @returns the HTTP handler.
 */
export function createDisplayConfigHandler(getDisplayConfig) {
    return (req, res) => {
        try {
            if (req.method !== 'GET') {
                requestError(res, 405, 'method-not-allowed', 'Use GET');
                return;
            }
            if (!sameOriginRequest(req)) {
                requestError(res, 403, 'origin-rejected', 'The request must originate from this DSH Web application');
                return;
            }
            responseJson(res, 200, { ok: true, value: getDisplayConfig() });
        }
        catch (error) {
            requestError(res, 500, 'display-config-failed', publicMessage(error));
        }
    };
}
/**
 * Attach optional Web routes whenever a webServer service is present.
 * @param ctx - plugin context owning route effects.
 * @param backend - Settings handler.
 * @param artifacts - signed Artifact handler.
 * @param pastedImages - pasted-image workspace handler.
 * @param pastePolicy - paste-policy verdict resolver (sessionId, selection, modelLabel).
 * @param getDisplayConfig - resolves display-mode flags for the browser client.
 */
export function installVisionToolkitWeb(ctx, backend, artifacts, pastedImages, pastePolicy, getDisplayConfig) {
    ctx.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => {
            backend.configureWebServer(webCtx.webServer.host, webCtx.webServer.port);
            const detach = artifacts.attachRoute();
            const disposeArtifact = webCtx.webServer.register({
                kind: 'prefix',
                path: ARTIFACT_ROUTE_PREFIX,
                handler: (req, res) => artifacts.handle(req, res),
            });
            const disposeSettings = webCtx.webServer.register({
                kind: 'exact',
                path: SETTINGS_ROUTE,
                handler: (req, res) => backend.handle(req, res),
            });
            const disposePasteImages = webCtx.webServer.register({
                kind: 'exact',
                path: PASTE_IMAGES_ROUTE,
                handler: (req, res) => pastedImages.handle(req, res),
            });
            const disposePastePolicy = webCtx.webServer.register({
                kind: 'exact',
                path: PASTE_POLICY_ROUTE,
                handler: createPastePolicyHandler(pastePolicy),
            });
            const disposeDisplayConfig = webCtx.webServer.register({
                kind: 'exact',
                path: DISPLAY_CONFIG_ROUTE,
                handler: createDisplayConfigHandler(getDisplayConfig),
            });
            return () => {
                disposeDisplayConfig();
                disposePastePolicy();
                disposePasteImages();
                disposeSettings();
                disposeArtifact();
                detach();
            };
        }, 'dsh-vision-toolkit: Web routes');
    });
}
//# sourceMappingURL=web.js.map