/**
 * Vision Toolkit runtime: structured requests in, structured results out.
 * One operation-wide deadline reaches every subprocess; image decoding,
 * byte/pixel limits, session-scoped concurrency, credential resolution, safe
 * output staging, and diagnostic logging stay below the model-facing tools.
 * @module dsh-vision-toolkit/runtime
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ArtifactDescriptor } from './artifacts.ts';
import type { ResolvedVisionToolkitConfig } from './config.ts';
import { UpstreamAdapter, type DominantColorsOutput, type UpstreamEnvironment, type UpstreamVersionInfo } from './upstream.ts';
/** Per-invocation cancellation and timeout facts. */
export interface Deadline {
    signal: AbortSignal;
    /** True when the deadline timer fired. */
    timedOut: boolean;
    /** True when the caller signal fired first. */
    cancelled: boolean;
    /** Clear the timer and caller listener. */
    cleanup(): void;
}
/** Combine a caller abort signal with one hard operation timeout. */
export declare function createDeadline(signal: AbortSignal, timeoutMs: number): Deadline;
/** FIFO bounded concurrency gate whose queued callers remain cancellable. */
export declare class Semaphore {
    private readonly limit;
    private active;
    private readonly waiters;
    constructor(limit: number);
    /** Whether no active or queued caller still owns this gate. */
    get idle(): boolean;
    /** Acquire one slot, aborting while queued when `signal` fires. */
    acquire(signal: AbortSignal, permits?: number): Promise<void>;
    /** Release owned permits and wake FIFO waiters whose full weight now fits. */
    release(permits?: number): void;
}
/** Validated image metadata retained in structured results and diagnostics. */
export interface ImageInfo {
    path: string;
    bytes: number;
    width: number;
    height: number;
    format: string;
}
/** Structured input for one glance call. */
export interface GlanceRequest {
    images: string[];
    query?: string;
    ocr?: boolean;
    region?: string;
}
/** Structured glance result. */
export interface GlanceResult {
    images: ImageInfo[];
    mode: 'describe' | 'qa' | 'ocr';
    answer: string;
    truncated: boolean;
}
/** Structured input for ground/detect. */
export interface LocateRequest {
    image: string;
    target: string;
    region?: string;
}
/** One located element with an upstream or caller label. */
export interface LocateMatch {
    label: string;
    box: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    };
}
/** Structured ground result. */
export interface GroundResult {
    target: string;
    image: ImageInfo;
    imageWidth: number;
    imageHeight: number;
    matches: LocateMatch[];
    preview?: ArtifactDescriptor;
}
/** Structured detect result. */
export interface DetectResult {
    category: string;
    image: ImageInfo;
    imageWidth: number;
    imageHeight: number;
    elements: Array<{
        index: number;
        label: string;
        box: {
            x1: number;
            y1: number;
            x2: number;
            y2: number;
        };
    }>;
    preview?: ArtifactDescriptor;
}
/** Structured crop request. */
export interface CropRequest {
    image: string;
    region: string;
    scale?: number;
    output?: string;
}
/** Structured crop result. */
export interface CropResult {
    imageWidth: number;
    imageHeight: number;
    region: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    };
    outputPath: string;
    mimeType: 'image/png' | 'image/jpeg';
    width: number;
    height: number;
    clamped: boolean;
    artifact: ArtifactDescriptor;
    note?: string;
}
/** Structured trace request supported by the pinned upstream snapshot. */
export interface TraceRequest {
    image: string;
    region?: string;
    scale?: number;
    color?: boolean;
    polygon?: boolean;
    output?: string;
}
/** Structured trace result. */
export interface TraceResult {
    imageWidth: number;
    imageHeight: number;
    outputPath: string;
    mimeType: 'image/svg+xml';
    geometry: {
        status: 'generated' | 'empty';
        pathCount: number;
        tracedScale: number;
        bytes: number;
    };
    artifact: ArtifactDescriptor;
    warning?: string;
}
/** Structured input for local image comparison. */
export interface PixelDiffRequest {
    original: string;
    rebuilt: string;
    grid?: number;
    top?: number;
    runName?: string;
}
/** Structured local pixel comparison plus formally delivered files. */
export interface PixelDiffResult {
    original: ImageInfo;
    rebuilt: ImageInfo;
    scaled: boolean;
    rebuiltOriginalSize?: {
        width: number;
        height: number;
    };
    overallDifferencePct: number;
    worstRegions: Array<{
        index: number;
        differencePct: number;
        box: {
            x1: number;
            y1: number;
            x2: number;
            y2: number;
        };
    }>;
    heatmap: ArtifactDescriptor;
    report: ArtifactDescriptor;
}
/** Structured input for the pinned long-screenshot OCR pipeline. */
export interface LongScreenshotOcrRequest {
    image: string;
    mode?: 'general' | 'chat';
    output?: string;
    runName?: string;
    targetHeight?: number;
    minHeight?: number;
    maxHeight?: number;
    overlap?: number;
    prompt?: string;
    jobs?: number;
    chunkTimeoutSeconds?: number;
    splitOnly?: boolean;
    resume?: boolean;
}
/** One long-OCR chunk and the files retained for audit or reuse. */
export interface LongScreenshotChunk {
    index: number;
    coreTop: number;
    coreBottom: number;
    cropTop: number;
    cropBottom: number;
    image: ArtifactDescriptor;
    ocr?: ArtifactDescriptor;
    reused?: boolean;
}
/** Long-screenshot split/OCR result with every durable deliverable. */
export interface LongScreenshotOcrResult {
    source: ImageInfo;
    mode: 'general' | 'chat';
    splitOnly: boolean;
    complete: boolean;
    chunkCount: number;
    runDirectory: string;
    output?: ArtifactDescriptor;
    manifest: ArtifactDescriptor;
    audit?: ArtifactDescriptor;
    chunks: LongScreenshotChunk[];
}
/** Structured input for transparent foreground extraction. */
export interface ExtractForegroundRequest {
    image: string;
    region?: string;
    boxes?: string;
    mode?: 'color' | 'dark';
    discRadius?: number;
    saturation?: number;
    darkThreshold?: number;
    excludeColor?: string;
    excludeTolerance?: number;
    padding?: number;
    keepWhites?: boolean;
    output?: string;
}
/** Transparent foreground file plus the pinned script's component metrics. */
export interface ExtractForegroundResult {
    source: ImageInfo;
    box: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    };
    foregroundPixels: number;
    keptComponents: number;
    totalComponents: number;
    largestComponentPct: number;
    width: number;
    height: number;
    artifact: ArtifactDescriptor;
    autoSummary?: string;
}
/** Structured input for palette extraction or candidate scoring. */
export interface DominantColorsRequest {
    image: string;
    region?: string;
    candidates?: string[];
    top?: number;
    quantize?: number;
    maxPixels?: number;
    mergeTolerance?: number;
    candidateTolerance?: number;
}
/** Stable dominant-colour result enriched with source image facts. */
export interface DominantColorsResult {
    image: ImageInfo;
    analysis: DominantColorsOutput;
}
/** Structured input for rendering an authorized local HTML document. */
export interface HtmlScreenshotRequest {
    source: string;
    width?: number;
    height?: number;
    scale?: number;
    waitMs?: number;
    output?: string;
}
/** Browser-rendered PNG plus viewport and source facts. */
export interface HtmlScreenshotResult {
    sourcePath: string;
    sourceBytes: number;
    viewport: {
        width: number;
        height: number;
        scale: number;
    };
    width: number;
    height: number;
    artifact: ArtifactDescriptor;
}
/** Optional preview controls shared by ground and detect. */
export interface LocatePreviewRequest extends LocateRequest {
    preview?: boolean;
    previewOutput?: string;
}
/** One named health-check state. */
export interface HealthCheck {
    status: 'ok' | 'warning' | 'error' | 'not_tested';
    detail: string;
}
/** Runtime, dependency, storage, credential, and optional service health. */
export interface VisionToolkitHealthResult {
    pluginVersion: string;
    upstream: UpstreamVersionInfo;
    checks: {
        python: HealthCheck;
        dependencies: HealthCheck;
        chrome: HealthCheck;
        credential: HealthCheck;
        artifactDirectory: HealthCheck;
        tempDirectory: HealthCheck;
        service: HealthCheck;
        model: HealthCheck;
    };
    healthy: boolean;
    connectionTested: boolean;
    modelTested: boolean;
}
/** Shared per-call execution options. */
export interface ToolCallOptions {
    signal: AbortSignal;
    timeoutMs?: number;
    workspace: string;
    /** Session identity for the per-session concurrency cap. */
    sessionId?: string;
    /** Live Session object whose lifetime bounds the one-entry glance cache. */
    sessionScope?: object;
}
/** Parse a non-empty four-integer pixel box. */
export declare function parseRegion(region: string): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};
/** Runtime facade used by every native tool. */
export declare class VisionToolkitRuntime {
    private readonly ctx;
    private readonly config;
    private readonly semaphores;
    private readonly glanceCache;
    private readonly adapter;
    constructor(ctx: Context, config: ResolvedVisionToolkitConfig, adapter?: UpstreamAdapter);
    /** Pinned and prepared upstream identity. */
    get upstreamVersion(): UpstreamVersionInfo;
    private timeout;
    private operationError;
    private semaphore;
    private runOperation;
    /** Resolve the configured credential at the remote-operation boundary. */
    resolveVisionEnv(): Promise<UpstreamEnvironment>;
    private visionEnv;
    private pathPolicy;
    private validateImage;
    private accountImage;
    private glanceCacheKey;
    private runUpstream;
    private probeGeneratedImage;
    private annotateLocations;
    /** glance: describe, targeted QA, OCR, or multi-image comparison. */
    glance(request: GlanceRequest, options: ToolCallOptions): Promise<GlanceResult>;
    private validateLocations;
    private locate;
    /** ground: locate one named target and return pixel boxes. */
    ground(request: LocatePreviewRequest, options: ToolCallOptions): Promise<GroundResult>;
    /** detect: inventory every instance of a kind. */
    detect(request: LocatePreviewRequest, options: ToolCallOptions): Promise<DetectResult>;
    /** crop: cut a pixel box into its own image file without requiring a credential. */
    crop(request: CropRequest, options: ToolCallOptions): Promise<CropResult>;
    /** trace: recover an SVG through the pinned upstream vtracer pipeline. */
    trace(request: TraceRequest, options: ToolCallOptions): Promise<TraceResult>;
    /** pixel_diff: compare real pixels, rank error regions, and deliver a heatmap plus JSON report. */
    pixelDiff(request: PixelDiffRequest, options: ToolCallOptions): Promise<PixelDiffResult>;
    /** long_screenshot_ocr: split safely, optionally OCR, and atomically deliver the complete audit run. */
    longScreenshotOcr(request: LongScreenshotOcrRequest, options: ToolCallOptions): Promise<LongScreenshotOcrResult>;
    /** extract_foreground: preserve the pinned component selection and deliver an RGBA PNG. */
    extractForeground(request: ExtractForegroundRequest, options: ToolCallOptions): Promise<ExtractForegroundResult>;
    /** dominant_colors: expose palette clusters or candidate scores as structure, never stdout prose. */
    dominantColors(request: DominantColorsRequest, options: ToolCallOptions): Promise<DominantColorsResult>;
    /** html_screenshot: render only a path-fenced local HTML file in the pinned Chrome adapter. */
    htmlScreenshot(request: HtmlScreenshotRequest, options: ToolCallOptions): Promise<HtmlScreenshotResult>;
    private writableDirectoryCheck;
    /** Health: inspect local readiness, optionally probe `/models`, and explicitly test one real multimodal request. */
    health(testConnection: boolean, options: ToolCallOptions, testModel?: boolean): Promise<VisionToolkitHealthResult>;
    /** Report the packaged upstream snapshot version. */
    checkoutVersion(): Promise<string>;
    /** Prepared Python command. */
    python(): string;
}
//# sourceMappingURL=runtime.d.ts.map