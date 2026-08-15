/**
 * Optional Web-profile routes: signed Artifact delivery plus a same-origin
 * Settings/health endpoint. The browser never receives credential values and
 * connection tests run only after an explicit POST action.
 * @module dsh-vision-toolkit/web
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { ArtifactAccessController } from './artifact-access.ts';
import { PastedImageBackend } from './paste-images.ts';
import { type VisionToolkitConfig } from './config.ts';
import { VisionToolkitRuntimeManager, type PreparedRuntimeGeneration, type RuntimeManagerStatus } from './runtime-manager.ts';
/** Exact route used by the browser Settings page. */
export declare const SETTINGS_ROUTE = "/_dsh/vision-toolkit/settings";
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
/** Callback invoked when a Settings save makes the first runtime available. */
export type RuntimeActivated = () => void;
/** Same-origin Settings and health handler. */
export declare class VisionToolkitWebBackend {
    private readonly ctx;
    private readonly manager;
    private readonly artifacts;
    private readonly onRuntimeActivated;
    constructor(ctx: Context, manager: WebRuntimeManager, artifacts: ArtifactAccessController, onRuntimeActivated: RuntimeActivated);
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
 * turn a paste into workspace paths instead of the native attachment flow.
 * Answers false for every unresolved route — native paste is the safe default.
 * @param takeover - resolves one live Session's paste verdict.
 * @returns the HTTP handler.
 */
export declare function createPastePolicyHandler(takeover: (sessionId: string) => Promise<boolean>): (req: IncomingMessage, res: ServerResponse) => void;
/**
 * Attach optional Web routes whenever a webServer service is present.
 * @param ctx - plugin context owning route effects.
 * @param backend - Settings handler.
 * @param artifacts - signed Artifact handler.
 * @param pastedImages - pasted-image workspace handler.
 * @param pastePolicy - paste-takeover verdict resolver.
 */
export declare function installVisionToolkitWeb(ctx: Context, backend: VisionToolkitWebBackend, artifacts: ArtifactAccessController, pastedImages: PastedImageBackend, pastePolicy: (sessionId: string) => Promise<boolean>): void;
//# sourceMappingURL=web.d.ts.map