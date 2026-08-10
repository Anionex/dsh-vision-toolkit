/**
 * Vision Toolkit runtime: structured requests in, structured results out.
 * One operation-wide deadline reaches every subprocess; image decoding,
 * byte/pixel limits, session-scoped concurrency, credential resolution, safe
 * output staging, and diagnostic logging stay below the model-facing tools.
 * @module dsh-vision-toolkit/runtime
 */
import type { Context } from 'cordis';
import type { ResolvedVisionToolkitConfig } from './config.ts';
import { UpstreamAdapter, type UpstreamEnvironment, type UpstreamVersionInfo } from './upstream.ts';
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
    acquire(signal: AbortSignal): Promise<void>;
    /** Release one slot and transfer it directly to the longest-waiting caller. */
    release(): void;
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
    imageWidth: number;
    imageHeight: number;
    matches: LocateMatch[];
}
/** Structured detect result. */
export interface DetectResult {
    category: string;
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
    warning?: string;
}
/** Shared per-call execution options. */
export interface ToolCallOptions {
    signal: AbortSignal;
    timeoutMs?: number;
    workspace: string;
    /** Session identity for the per-session concurrency cap. */
    sessionId?: string;
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
    private pathPolicy;
    private validateImage;
    private accountImage;
    private runUpstream;
    /** glance: describe, targeted QA, OCR, or multi-image comparison. */
    glance(request: GlanceRequest, options: ToolCallOptions): Promise<GlanceResult>;
    private validateLocations;
    private locate;
    /** ground: locate one named target and return pixel boxes. */
    ground(request: LocateRequest, options: ToolCallOptions): Promise<GroundResult>;
    /** detect: inventory every instance of a kind. */
    detect(request: LocateRequest, options: ToolCallOptions): Promise<DetectResult>;
    /** crop: cut a pixel box into its own image file without requiring a credential. */
    crop(request: CropRequest, options: ToolCallOptions): Promise<CropResult>;
    /** trace: recover an SVG through the pinned upstream vtracer pipeline. */
    trace(request: TraceRequest, options: ToolCallOptions): Promise<TraceResult>;
    /** Report the packaged upstream snapshot version. */
    checkoutVersion(): Promise<string>;
    /** Prepared Python command. */
    python(): string;
}
//# sourceMappingURL=runtime.d.ts.map