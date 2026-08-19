/**
 * Optional Web-profile routes: signed Artifact delivery plus a same-origin
 * Settings/health endpoint. The browser never receives credential values and
 * connection tests run only after an explicit POST action.
 * @module dsh-vision-toolkit/web
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { ArtifactAccessController } from './artifact-access.ts';
import { PastedImageBackend, type PasteSelectionQuery, type PasteVerdict } from './paste-images.ts';
import { type VisionToolkitConfig } from './config.ts';
import { type PluginUpdateCapability, type PluginUpdateCheck, type PluginUpdateResult } from './plugin-update.ts';
import { VisionToolkitRuntimeManager, type PreparedRuntimeGeneration, type RuntimeManagerStatus } from './runtime-manager.ts';
/** Exact route used by the browser Settings page. */
export declare const SETTINGS_ROUTE = "/_dsh/vision-toolkit/settings";
/** Same-origin route used by the browser client to read display-mode flags. */
export declare const DISPLAY_CONFIG_ROUTE = "/_dsh/vision-toolkit/display-config";
/** Public Settings snapshot; credential values are deliberately impossible here. */
export interface VisionToolkitSettingsSnapshot {
    schemaVersion: 1;
    writable: boolean;
    settings: {
        value: VisionToolkitConfig;
        user?: unknown;
        base?: unknown;
        revision: number;
        applies: 'live';
    };
    credential: {
        ref: string;
        configured: boolean;
        source?: string;
        writable: boolean;
    };
    runtime: RuntimeManagerStatus;
    release: {
        pluginVersion: string;
        upstreamRepository: string;
        upstreamVersion: string;
        upstreamCommit: string;
        update: PluginUpdateCapability;
    };
    artifactRouteAvailable: boolean;
}
/** Minimal runtime-manager face used by the Web route and its tests. */
export interface WebRuntimeManager {
    readonly ready: boolean;
    current(): ReturnType<VisionToolkitRuntimeManager['current']>;
    prepareCandidate(raw: VisionToolkitConfig): Promise<PreparedRuntimeGeneration>;
    activateCandidate(candidate: PreparedRuntimeGeneration): void;
    recordFailure(error: unknown): void;
    status(): RuntimeManagerStatus;
}
/** Minimal self-update face used by the Web route and its tests. */
export interface WebPluginUpdater {
    configureWebServer?(host: string, port: number): void;
    capability(): Promise<PluginUpdateCapability>;
    check(): Promise<PluginUpdateCheck>;
    installAndRestart(expectedVersion: string): Promise<PluginUpdateResult>;
}
/** Callback invoked when a Settings save makes the first runtime available. */
export type RuntimeActivated = () => void;
/** Same-origin Settings and health handler. */
export declare class VisionToolkitWebBackend {
    private readonly ctx;
    private readonly manager;
    private readonly artifacts;
    private readonly onRuntimeActivated;
    private readonly updater;
    constructor(ctx: Context, manager: WebRuntimeManager, artifacts: ArtifactAccessController, onRuntimeActivated: RuntimeActivated, updater?: WebPluginUpdater);
    /** Supply the active listener address before the Settings route becomes reachable. */
    configureWebServer(host: string, port: number): void;
    private credential;
    /** Build the current settings/runtime/credential snapshot without secrets. */
    snapshot(): Promise<VisionToolkitSettingsSnapshot>;
    private save;
    private saveCredential;
    private health;
    /** Handle the exact Settings route. */
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
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
export declare function createPastePolicyHandler(resolve: (sessionId: string, selection?: PasteSelectionQuery, modelLabel?: string) => Promise<PasteVerdict>): (req: IncomingMessage, res: ServerResponse) => void;
/**
 * Same-origin display-config handler: exposes whether transparent routing is
 * active. The paste integration uses it to choose its notice text; the model
 * selector hides upstream twins synchronously from DOM display names and does
 * not depend on this route.
 * @param getDisplayConfig - resolves the current display-mode flags.
 * @returns the HTTP handler.
 */
export declare function createDisplayConfigHandler(getDisplayConfig: () => {
    hidden: boolean;
}): (req: IncomingMessage, res: ServerResponse) => void;
/**
 * Attach optional Web routes whenever a webServer service is present.
 * @param ctx - plugin context owning route effects.
 * @param backend - Settings handler.
 * @param artifacts - signed Artifact handler.
 * @param pastedImages - pasted-image workspace handler.
 * @param pastePolicy - paste-policy verdict resolver (sessionId, selection, modelLabel).
 * @param getDisplayConfig - resolves display-mode flags for the browser client.
 */
export declare function installVisionToolkitWeb(ctx: Context, backend: VisionToolkitWebBackend, artifacts: ArtifactAccessController, pastedImages: PastedImageBackend, pastePolicy: (sessionId: string, selection?: PasteSelectionQuery, modelLabel?: string) => Promise<PasteVerdict>, getDisplayConfig: () => {
    hidden: boolean;
}): void;
//# sourceMappingURL=web.d.ts.map