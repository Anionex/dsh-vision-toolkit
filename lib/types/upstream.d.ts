/**
 * Upstream adapter: locates the pinned agent-vision-toolkit checkout, converts
 * structured requests into direct Python invocations (never shell-concatenated),
 * captures bounded stdout/stderr, and converts the upstream's stable text
 * contracts into structured results. All algorithm behavior stays upstream.
 * @module dsh-vision-toolkit/upstream
 */
import type { Context } from 'cordis';
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess';
import type { ResolvedVisionToolkitConfig } from './config.ts';
import { VisionToolkitError } from './errors.ts';
/** One upstream CLI. */
export type UpstreamTool = 'glance' | 'ground' | 'detect' | 'crop' | 'trace';
/** Vision configuration forwarded to the upstream subprocess as explicit env. */
export interface UpstreamEnvironment {
    VISION_API_KEY: string;
    VISION_BASE_URL: string;
    VISION_MODEL: string;
    LANG: 'zh' | 'en';
}
/** Pinned upstream identity plus the resolved local checkout. */
export interface UpstreamVersionInfo {
    repository: string;
    version: string;
    commit: string;
    path: string;
}
/** Settled upstream process facts plus bounded output. */
export interface UpstreamRunResult {
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    outcome: SubprocessOutcome;
}
/** Pixel box in original-image coordinates. */
export interface PixelBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}
/** One ground/detect match line converted to structure. */
export interface LocatedElement {
    label?: string;
    box: PixelBox;
}
/** Parsed crop CLI result. */
export interface CropOutput {
    outputPath: string;
    width: number;
    height: number;
    clamped: boolean;
    note?: string;
}
/** Trace report fields consumed by the plugin. */
export interface TraceReport {
    mode: string;
    logicalSize: [number, number];
    perception?: {
        label?: string;
        confidence?: unknown;
    };
    geometry: {
        status: string;
        confidence: unknown;
        primitiveCount?: number;
        representation?: string;
        strokeWidth?: number;
        pixelFit?: number;
    };
}
/** Parse one numbered upstream location line (`N. position label x1: ..., ...`). */
export declare function parseLocationLine(line: string): LocatedElement | undefined;
/** Parse ground/detect stdout into located elements; empty output means no matches. */
export declare function parseLocationOutput(stdout: string): LocatedElement[];
/** Parse the crop CLI's `wrote <path> (WxH)` line and clamp note. */
export declare function parseCropOutput(stdout: string, stderr: string): CropOutput;
/** Parse the trace `--report` JSON into the plugin's typed view. */
export declare function parseTraceReport(text: string): TraceReport;
/** Conventional upstream locations probed when no explicit path is configured. */
export declare function defaultUpstreamCandidates(): string[];
/**
 * Find the first candidate that is a real upstream checkout: a directory
 * containing every required bin script. A conventional location that exists
 * but is only a config directory is skipped, not treated as the runtime.
 * @param candidates - candidate roots in priority order.
 * @returns the real path of the first valid checkout.
 */
export declare function findCheckout(candidates: readonly string[]): Promise<string>;
/**
 * Adapter over one pinned upstream checkout. `prepare()` runs synchronously
 * enough to be part of plugin load: stat-based verification of the checkout
 * layout; the plugin registers tools and skill only after it succeeds.
 */
export declare class UpstreamAdapter {
    private readonly ctx;
    private readonly config;
    private version;
    private secrets;
    constructor(ctx: Context, config: ResolvedVisionToolkitConfig, version?: UpstreamVersionInfo);
    /** Upstream identity reported to tools and logs. */
    get versionInfo(): UpstreamVersionInfo;
    /** Secrets currently known to the adapter (used for redaction). */
    get secretValues(): readonly string[];
    /**
     * Verify the upstream checkout layout; throws a runtime error with the
     * next action when anything is missing.
     */
    prepare(): Promise<void>;
    /**
     * Run one upstream CLI with explicit vision env. Never goes through a
     * shell: argv is passed verbatim to the managed subprocess.
     */
    run(tool: UpstreamTool, args: readonly string[], options: {
        signal: AbortSignal;
        workspace: string;
        env: UpstreamEnvironment;
    }): Promise<UpstreamRunResult>;
    /**
     * Read an image's pixel dimensions through the upstream's own Pillow
     * dependency without inventing a second image codec.
     */
    probeImageSize(imagePath: string, options: {
        signal: AbortSignal;
        workspace: string;
    }): Promise<{
        width: number;
        height: number;
    }>;
    private collectProbe;
    /**
     * Read the pinned version marker from the checkout (`VERSION` file when
     * present), falling back to the packaged pin.
     */
    readCheckoutVersion(): Promise<string>;
    /** Whether the upstream checkout exposes the optional `html_shot` script (P1 surface). */
    hasScript(name: string): Promise<boolean>;
    /** Turn a failed run into a model-safe classified error. */
    classifyFailure(tool: UpstreamTool, result: UpstreamRunResult, options: {
        timedOut: boolean;
        cancelled: boolean;
    }): VisionToolkitError;
}
//# sourceMappingURL=upstream.d.ts.map