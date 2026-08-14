/**
 * DSH Vision Toolkit browser plugin: dedicated Tool cards plus the Settings,
 * health, connection-test, and safe Artifact preview experience.
 */
import type { ClientContext, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
declare const en: {
    readonly nav: "Vision";
    readonly settingsTitle: "Vision Toolkit";
    readonly settingsIntro: "Configure the pinned visual engineering runtime, its external vision endpoint, and local safety limits.";
    readonly externalNotice: "Remote tools send the selected image bytes to the configured external vision API. Local crop, trace, pixel diff, palette, foreground extraction, and HTML rendering do not upload images.";
    readonly provider: "Vision service";
    readonly baseUrl: "Base URL";
    readonly credential: "Credential reference";
    readonly model: "Model";
    readonly language: "Output language";
    readonly limits: "Limits";
    readonly timeout: "Request timeout (ms)";
    readonly maxBytes: "Maximum image bytes";
    readonly maxPixels: "Maximum image pixels";
    readonly concurrency: "Concurrent calls per session";
    readonly runtime: "Runtime";
    readonly runtimeMode: "Runtime mode";
    readonly toolkitPath: "Pinned checkout path";
    readonly python: "Python override";
    readonly allowedDirs: "Additional allowed directories";
    readonly allowedDirsHint: "One path per line. The session workspace is always allowed.";
    readonly save: "Save and apply";
    readonly saving: "Validating runtime…";
    readonly reload: "Reload";
    readonly saved: "Settings validated and applied.";
    readonly readOnly: "The active Settings provider is read-only.";
    readonly configured: "Configured";
    readonly missing: "Missing";
    readonly source: "Source";
    readonly health: "Health";
    readonly runHealth: "Run health check";
    readonly testConnection: "Test connection";
    readonly testing: "Checking…";
    readonly connectionHint: "Connection testing explicitly sends the configured credential to GET /models. It uploads no image and creates no completion.";
    readonly pluginVersion: "Plugin";
    readonly upstreamVersion: "Upstream";
    readonly activeGeneration: "Runtime generation";
    readonly runtimeUnavailable: "Runtime unavailable";
    readonly runtimeCandidateRejected: "Last runtime candidate was rejected; the active generation remains available.";
    readonly retry: "Retry";
    readonly open: "Open file";
    readonly download: "Download";
    readonly previewUnavailable: "HTTP preview is unavailable in this host; use Open file.";
    readonly running: "Running…";
    readonly failed: "Failed";
    readonly matches: "matches";
    readonly elements: "elements";
    readonly dimensions: "Dimensions";
    readonly coordinates: "Coordinates";
    readonly artifact: "Artifact";
    readonly artifacts: "Artifacts";
    readonly difference: "Overall difference";
    readonly worstRegions: "Worst regions";
    readonly colors: "Dominant colors";
    readonly noResult: "Structured result unavailable; inspect the raw Tool result.";
    readonly healthy: "Healthy";
    readonly degraded: "Needs attention";
    readonly notTested: "Not tested";
};
type LocaleKey = keyof typeof en;
interface ToolCallOwnerProps {
    callId: string;
    toolName: string;
    block: ToolCallBlock;
    cwd?: string | undefined;
    openFile: (path: string) => void;
    inspect?: (() => void) | undefined;
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /** Keyed atomic Tool call view, dispatched by wire Tool name. */
        'tool.call.toolview': {
            kind: 'keyed';
            scope: 'session';
            owner: ToolCallOwnerProps;
        };
    }
    interface LocaleNamespaceMap {
        /** DSH Vision Toolkit Tool cards and Settings copy. */
        'vision-toolkit': LocaleKey;
    }
}
interface HealthCheck {
    status: 'ok' | 'warning' | 'error' | 'not_tested';
    detail: string;
}
interface HealthResult {
    pluginVersion: string;
    checks: Record<string, HealthCheck>;
    healthy: boolean;
    connectionTested: boolean;
}
interface SettingsValue {
    provider?: {
        baseUrl?: string;
        credential?: string;
        model?: string;
    };
    language?: 'zh' | 'en';
    timeoutMs?: number;
    maxImageBytes?: number;
    maxImagePixels?: number;
    concurrency?: number;
    runtime?: {
        mode?: 'managed' | 'external';
        agentVisionToolkitPath?: string;
        python?: string;
    };
    allowedDirs?: string[];
}
interface SettingsSnapshot {
    schemaVersion: 1;
    writable: boolean;
    settings: {
        value: SettingsValue;
        revision: number;
        applies: 'live';
    };
    credential: {
        ref: string;
        configured: boolean;
        source?: string;
        writable: boolean;
    };
    runtime: {
        ready: boolean;
        generation: number;
        activeConfig?: SettingsValue;
        upstream?: {
            source: 'managed' | 'external';
            path: string;
            runtimeHome: string;
            python: string;
            pythonVersion: string;
        };
        lastError?: string;
    };
    release: {
        pluginVersion: string;
        upstreamRepository: string;
        upstreamVersion: string;
        upstreamCommit: string;
    };
    artifactRouteAvailable: boolean;
}
/** Decode canonical presentation metadata with a JSON-text fallback. */
export declare function decodeVisionResult(block: ToolCallBlock): Record<string, unknown> | undefined;
interface SettingsState {
    status: 'idle' | 'loading' | 'ready' | 'error';
    snapshot?: SettingsSnapshot | undefined;
    health?: HealthResult | undefined;
    action?: 'save' | 'health' | 'connection' | undefined;
    message?: string | undefined;
    error?: string | undefined;
}
/** Small external store shared by the Settings route and pushed invalidations. */
export declare class VisionSettingsController {
    private state;
    private listeners;
    private generation;
    subscribe: (listener: () => void) => (() => void);
    snapshot: () => SettingsState;
    private set;
    load(): Promise<void>;
    refreshIfLoaded(): void;
    save(value: SettingsValue, expectedRevision: number): Promise<void>;
    runHealth(testConnection: boolean): Promise<void>;
}
/** Required client services. The pasted-image codec attaches to either trigger-service generation after load. */
export declare const inject: string[];
/** Register dedicated Tool views and the Vision Settings section. */
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map