/**
 * Vision Toolkit runtime: structured requests in, structured results out.
 * It validates paths and limits, resolves the credential per operation, holds
 * a bounded concurrency slot, synthesizes cancellation + timeout into the
 * upstream process signal, and classifies failures for the model.
 * @module dsh-vision-toolkit/runtime
 */
import type { Context } from 'cordis';
import type { JsonValue } from '@deepseek-ai/dsh-session';
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
/**
 * Combine a caller abort signal with a hard timeout so the upstream process
 * tree receives one signal and the failure can be classified precisely.
 * @param signal - caller-owned cancellation.
 * @param timeoutMs - execution budget in milliseconds.
 * @returns fused deadline handles.
 */
export declare function createDeadline(signal: AbortSignal, timeoutMs: number): Deadline;
/** Bounded concurrency gate; waiting respects the caller signal. */
export declare class Semaphore {
    private readonly limit;
    private active;
    private readonly waiters;
    constructor(limit: number);
    /** Acquire one slot, aborting while queued when `signal` fires. */
    acquire(signal: AbortSignal): Promise<void>;
    /** Release one slot and wake the longest-waiting caller. */
    release(): void;
}
/** Structured input for one glance call. */
export interface GlanceRequest {
    images: string[];
    query?: string;
    ocr?: boolean;
    region?: string;
}
/** Structured glance result — the description is the model-visible answer. */
export interface GlanceResult {
    images: Array<{
        path: string;
        bytes: number;
    }>;
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
/** One located element with an optional upstream label. */
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
/** trace mode flags passed through to the upstream CLI. */
export type TraceMode = 'deterministic' | 'perceive' | 'synthesize' | 'review';
/** Structured trace request. */
export interface TraceRequest {
    image: string;
    region?: string;
    scale?: number;
    strokeWidth?: number;
    color?: boolean;
    filled?: boolean;
    outline?: boolean;
    mode?: TraceMode;
    requireProduction?: boolean;
    output?: string;
}
/** Structured trace result. */
export interface TraceResult {
    imageWidth: number;
    imageHeight: number;
    outputPath: string;
    mimeType: 'image/svg+xml';
    geometry: {
        status: string;
        confidence: JsonValue;
        primitiveCount?: number;
        representation?: string;
        strokeWidth?: number;
        pixelFit?: number;
    };
    perception?: {
        label?: string;
        confidence?: JsonValue;
    };
    warning?: string;
}
/** Shared per-call execution options. */
export interface ToolCallOptions {
    signal: AbortSignal;
    timeoutMs?: number;
    workspace: string;
}
/** Parse a four-integer pixel box; a malformed box is an input error. */
export declare function parseRegion(region: string): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};
/**
 * Runtime facade used by every tool; tools never call the upstream adapter
 * directly, and the future P2 service will consume the same methods.
 */
export declare class VisionToolkitRuntime {
    private readonly ctx;
    private readonly config;
    private readonly semaphore;
    private readonly adapter;
    constructor(ctx: Context, config: ResolvedVisionToolkitConfig, adapter?: UpstreamAdapter);
    /** Pinned upstream identity. */
    get upstreamVersion(): UpstreamVersionInfo;
    /** Resolve the configured credential at the operation boundary. */
    resolveVisionEnv(): Promise<UpstreamEnvironment>;
    /**
     * Run one bounded tool request. Concurrency, credential resolution, path
     * fencing, and the deadline all live here, not in the tool definitions.
     */
    private runBounded;
    /** Resolve the path fence for one invocation's workspace. */
    private pathPolicy;
    /** Validate one input image against fence and size limits. */
    private validateImage;
    /** Run the upstream adapter inside the invocation deadline. */
    private runUpstream;
    /** glance: describe, targeted QA, OCR, or multi-image comparison. */
    glance(request: GlanceRequest, options: ToolCallOptions): Promise<GlanceResult>;
    /** Shared locate path for ground and detect. */
    private locate;
    /** ground: locate one named target and return pixel boxes. */
    ground(request: LocateRequest, options: ToolCallOptions): Promise<GroundResult>;
    /** detect: inventory every instance of a kind. */
    detect(request: LocateRequest, options: ToolCallOptions): Promise<DetectResult>;
    /** crop: cut a pixel box into its own image file. */
    crop(request: CropRequest, options: ToolCallOptions): Promise<CropResult>;
    /** trace: recover SVG geometry from a flat graphic. */
    trace(request: TraceRequest, options: ToolCallOptions): Promise<TraceResult>;
    /** Report the upstream checkout's own version marker (or the packaged pin). */
    checkoutVersion(): Promise<string>;
    /** The Python executable used to launch upstream CLIs. */
    python(): string;
}
//# sourceMappingURL=runtime.d.ts.map