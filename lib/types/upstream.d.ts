/**
 * Structured adapter over the pinned agent-vision-toolkit snapshot. Every
 * invocation is an argv vector through DSH Subprocess, runs from a clean home
 * so upstream env files cannot override DSH configuration, and converts the
 * pinned CLI contracts into stable data.
 * @module dsh-vision-toolkit/upstream
 */
import type { Context } from 'cordis';
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess';
import type { ResolvedVisionToolkitConfig } from './config.ts';
import { VisionToolkitError } from './errors.ts';
import { type PreparedUpstreamRuntime } from './runtime-install.ts';
/** One upstream CLI exposed by the P0 runtime. */
export type UpstreamTool = 'glance' | 'ground' | 'detect' | 'crop' | 'trace';
/** Vision configuration forwarded only to upstream commands that call the API. */
export interface UpstreamEnvironment {
    VISION_API_KEY: string;
    VISION_BASE_URL: string;
    VISION_MODEL: string;
    LANG: 'zh' | 'en';
}
/** Pinned upstream identity plus prepared runtime facts. */
export interface UpstreamVersionInfo {
    repository: string;
    version: string;
    commit: string;
    path: string;
    source: 'managed' | 'external';
    python: string;
    pythonVersion: string;
    dependencies: Record<string, string>;
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
/** Parsed trace CLI result from the pinned vtracer implementation. */
export interface TraceOutput {
    outputPath: string;
    bytes: number;
    pathCount: number;
    tracedScale: number;
}
/** Parse one numbered upstream location line (`N. position label x1: ..., ...`). */
export declare function parseLocationLine(line: string): LocatedElement | undefined;
/** Parse ground/detect stdout; non-empty unknown lines are an output contract failure. */
export declare function parseLocationOutput(stdout: string): LocatedElement[];
/** Parse the crop CLI's `wrote <path> (WxH)` line and clamp note. */
export declare function parseCropOutput(stdout: string, stderr: string): CropOutput;
/** Parse the pinned trace CLI's written-file summary. */
export declare function parseTraceOutput(stdout: string): TraceOutput;
/** Find the first candidate with the five pinned core CLI entrypoints. */
export declare function findCheckout(candidates: readonly string[]): Promise<string>;
/** Adapter over one prepared pinned upstream runtime. */
export declare class UpstreamAdapter {
    private readonly ctx;
    private readonly config;
    private prepared;
    constructor(ctx: Context, config: ResolvedVisionToolkitConfig, prepared?: PreparedUpstreamRuntime);
    /** Upstream identity reported to tools and logs. */
    get versionInfo(): UpstreamVersionInfo;
    private requirePrepared;
    /** Verify and prepare the configured source plus Python dependencies. */
    prepare(): Promise<void>;
    /** Run one upstream CLI without a shell. */
    run(tool: UpstreamTool, args: readonly string[], options: {
        signal: AbortSignal;
        env?: UpstreamEnvironment;
    }): Promise<UpstreamRunResult>;
    /** Read image dimensions through the prepared Pillow dependency. */
    probeImageSize(imagePath: string, options: {
        signal: AbortSignal;
    }): Promise<{
        width: number;
        height: number;
        format: string;
    }>;
    private collect;
    /** Report the pinned snapshot identity. */
    readCheckoutVersion(): Promise<string>;
    /** Whether the prepared snapshot carries one optional script path. */
    hasScript(name: string): Promise<boolean>;
    /** Read one prepared upstream text file for diagnostics or compatibility tests. */
    readText(relativePath: readonly string[]): Promise<string>;
    /** Turn a failed run into a model-safe classified error. */
    classifyFailure(tool: UpstreamTool, result: UpstreamRunResult, options: {
        timedOut: boolean;
        cancelled: boolean;
        secrets?: readonly string[];
    }): VisionToolkitError;
}
//# sourceMappingURL=upstream.d.ts.map