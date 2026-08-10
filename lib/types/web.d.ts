/**
 * Optional Web-profile routes: signed Artifact delivery plus a same-origin
 * Settings/health endpoint. The browser never receives credential values and
 * connection tests run only after an explicit POST action.
 * @module dsh-vision-toolkit/web
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from 'cordis';
import { ArtifactAccessController } from './artifact-access.ts';
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
    private health;
    /** Handle the exact Settings route. */
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
/**
 * Attach optional Web routes whenever an httpServer service is present.
 * @param ctx - plugin context owning route effects.
 * @param backend - Settings handler.
 * @param artifacts - signed Artifact handler.
 */
export declare function installVisionToolkitWeb(ctx: Context, backend: VisionToolkitWebBackend, artifacts: ArtifactAccessController): void;
//# sourceMappingURL=web.d.ts.map