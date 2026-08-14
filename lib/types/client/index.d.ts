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
    readonly providerHint: "Choose the API protocol, then provide the service address, model, and API key used by online vision features.";
    readonly baseUrl: "Base URL";
    readonly apiKey: "API key";
    readonly apiKeyPlaceholderMissing: "Paste the API key";
    readonly apiKeyPlaceholderConfigured: "Saved; leave blank to keep it";
    readonly apiKeyHint: "The key is stored in DSH Credentials and is never shown again after saving.";
    readonly apiKeyLocked: "The current key comes from a read-only source and cannot be replaced here.";
    readonly apiKeyBlank: "The API key cannot contain only spaces.";
    readonly apiKeyInvalid: "Paste only the key, without a variable name, quotes, spaces, or line breaks.";
    readonly credential: "Credential name";
    readonly credentialHint: "Advanced: the API key is stored under this name. Keep VISION_API_KEY unless another plugin configuration requires a different reference.";
    readonly model: "Model";
    readonly protocol: "API protocol";
    readonly anthropicThinking: "Anthropic thinking";
    readonly anthropicThinkingHint: "omit has the broadest compatibility. Use disabled or adaptive only when the selected model documents that mode; restore omit first after HTTP 400.";
    readonly userAgent: "User-Agent";
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
    readonly readOnly: "Service settings are read-only. A writable API key can still be saved.";
    readonly configured: "Configured";
    readonly missing: "Missing";
    readonly source: "Source";
    readonly sourceHint: "{source}: {value}";
    readonly sourceEnv: "Environment variable";
    readonly sourceFile: "Credential file";
    readonly health: "Health";
    readonly runHealth: "Run health check";
    readonly testConnection: "Test connection";
    readonly testing: "Checking…";
    readonly connectionHint: "Connection testing explicitly sends the configured credential to GET /models. It uploads no image and creates no completion.";
    readonly saveBeforeTesting: "Save service changes before testing the connection.";
    readonly advanced: "Advanced settings";
    readonly advancedHint: "Credential name, provider compatibility, output language, resource limits, runtime source, Python, and additional readable directories.";
    readonly pluginVersion: "Plugin";
    readonly upstreamVersion: "Upstream";
    readonly activeGeneration: "Runtime generation";
    readonly activeGenerationValue: "Generation {generation}";
    readonly pluginKind: "DSH native plugin";
    readonly runtimeUnavailable: "Runtime unavailable";
    readonly runtimeCandidateRejected: "Last runtime candidate was rejected; the active generation remains available.";
    readonly runtimeReady: "Ready";
    readonly runtimeManaged: "Managed";
    readonly runtimeExternal: "External checkout";
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
    readonly groundTitle: "Ground";
    readonly detectTitle: "Detect";
    readonly traceTitle: "Trace SVG";
    readonly pixelDiffTitle: "Pixel Diff";
    readonly cropTitle: "Crop";
    readonly longOcrTitle: "Long OCR";
    readonly extractForegroundTitle: "Extract Foreground";
    readonly htmlScreenshotTitle: "HTML Screenshot";
    readonly artifactTitle: "Vision Artifact";
    readonly dominantColorsTitle: "Dominant Colors";
    readonly artifactGroundPreview: "Grounding bounding-box preview";
    readonly artifactDetectPreview: "Detected-element bounding-box preview";
    readonly artifactCrop: "Cropped image region";
    readonly artifactTrace: "Traced vector geometry";
    readonly artifactDiffHeatmap: "Pixel-difference heatmap";
    readonly artifactDiffReport: "Structured pixel-difference report";
    readonly artifactLongManifest: "Long-screenshot split and merge manifest";
    readonly artifactLongTranscript: "Merged long-screenshot OCR transcript";
    readonly artifactLongAudit: "Long-screenshot OCR boundary audit";
    readonly artifactLongChunk: "Long-screenshot OCR chunk {index}";
    readonly artifactOcrSidecar: "OCR sidecar for chunk {index}";
    readonly artifactForeground: "Extracted transparent foreground";
    readonly artifactHtmlScreenshot: "Headless browser screenshot of local HTML";
    readonly label: "Label";
    readonly paths: "paths";
    readonly healthPython: "Python";
    readonly healthDependencies: "Dependencies";
    readonly healthChrome: "Browser";
    readonly healthCredential: "Credential";
    readonly healthArtifactDirectory: "Artifact directory";
    readonly healthTempDirectory: "Temporary directory";
    readonly healthService: "Vision service";
    readonly statusOk: "OK";
    readonly statusWarning: "Warning";
    readonly statusError: "Error";
    readonly statusNotTested: "Not tested";
    readonly positiveInteger: "{field} must be a positive integer.";
    readonly healthPythonDetail: "{version} via {path}";
    readonly healthChromeMissing: "Chrome, Chromium, or Edge was not found; HTML Screenshot is unavailable.";
    readonly healthChromeProbeFailed: "Could not check whether a supported browser is available.";
    readonly healthCredentialMissing: "Credential {credential} is not configured.";
    readonly healthCredentialReady: "Credential {credential} is available.";
    readonly healthCredentialFailed: "Could not read credential {credential}.";
    readonly healthDirectoryWritable: "{directory} is writable: {path}";
    readonly healthDirectoryNotWritable: "{directory} is not writable: {path}";
    readonly healthArtifactDirectoryFailed: "Could not prepare the artifact directory.";
    readonly healthConnectionNotTested: "Connection not tested. Use Test connection to query /models.";
    readonly healthConnectionCredentialMissing: "Connection test skipped because the credential is unavailable.";
    readonly healthServiceResponded: "Service responded at {endpoint} (HTTP {status}).";
    readonly healthServiceRejectedCredential: "Service rejected the configured credential (HTTP {status}).";
    readonly healthServiceNoModels: "Service is reachable but does not support GET /models (HTTP {status}).";
    readonly healthServiceRateLimited: "Service is reachable, but the connection test was rate-limited (HTTP 429).";
    readonly healthServiceHttpFailed: "Connection test failed with HTTP {status}.";
    readonly healthServiceUnreachable: "Could not reach {endpoint}.";
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
        protocol?: 'openai' | 'anthropic';
        anthropicThinking?: 'omit' | 'disabled' | 'adaptive';
        userAgent?: string;
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
    save(value: SettingsValue, expectedRevision: number, credentialValue: string | undefined, writeSettings: boolean): Promise<boolean>;
    runHealth(testConnection: boolean): Promise<void>;
}
/** Required client services. The pasted-image codec attaches to either trigger-service generation after load. */
export declare const inject: string[];
/** Register dedicated Tool views and the Vision Settings section. */
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map