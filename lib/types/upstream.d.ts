/**
 * Structured adapter over the pinned agent-vision-toolkit snapshot. Every
 * invocation is an argv vector through DSH Subprocess, runs from a clean home
 * so upstream env files cannot override DSH configuration, and converts the
 * pinned CLI contracts into stable data.
 * @module dsh-vision-toolkit/upstream
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess';
import type { ResolvedVisionToolkitConfig } from './config.ts';
import { VisionToolkitError } from './errors.ts';
import { type PreparedUpstreamRuntime } from './runtime-install.ts';
/** One pinned upstream CLI/script exposed by the runtime. */
export type UpstreamTool = 'glance' | 'ground' | 'detect' | 'crop' | 'trace' | 'pixel_diff' | 'long_screenshot_ocr' | 'extract_foreground' | 'dominant_colors' | 'html_screenshot';
/** Vision configuration forwarded only to upstream commands that call the API. */
export interface UpstreamEnvironment {
    VISION_API_KEY: string;
    VISION_BASE_URL: string;
    VISION_MODEL: string;
    VISION_API_PROTOCOL: 'chat_completions' | 'anthropic' | 'gemini';
    VISION_ANTHROPIC_THINKING: 'omit' | 'disabled' | 'adaptive';
    VISION_USER_AGENT: string;
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
    runtimeHome: string;
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
/** Parsed local pixel-diff report. */
export interface PixelDiffOutput {
    scaled: boolean;
    rebuiltOriginalSize?: {
        width: number;
        height: number;
    };
    scaledToSize?: {
        width: number;
        height: number;
    };
    overallDifferencePct: number;
    heatmapPath: string;
    worstRegions: Array<{
        index: number;
        differencePct: number;
        box: PixelBox;
    }>;
}
/** Parsed transparent foreground extraction report. */
export interface ExtractForegroundOutput {
    box: PixelBox;
    foregroundPixels: number;
    keptComponents: number;
    totalComponents: number;
    largestComponentPct: number;
    outputPath: string;
    width: number;
    height: number;
    autoSummary?: string;
}
/** One significant palette cluster from `dominant_colors.py`. */
export interface DominantColorCluster {
    color: string;
    sharePct: number;
}
/** One candidate-scoring row from `dominant_colors.py`. */
export interface DominantColorCandidate {
    color: string;
    sharePct: number;
    meanDistance: number;
    weightedScorePct: number;
    winner: boolean;
}
/** Structured dominant-colour result in palette or candidate mode. */
export type DominantColorsOutput = {
    mode: 'palette';
    region: PixelBox;
    width: number;
    height: number;
    requestedTop: number;
    clusterCount: number;
    mergeTolerance: number;
    colors: DominantColorCluster[];
} | {
    mode: 'candidates';
    region: PixelBox;
    width: number;
    height: number;
    sampledPixels: number;
    candidates: DominantColorCandidate[];
    winner: string;
    matchedWithinTolerance: boolean;
    closestCandidate?: string;
    note?: string;
};
/** Parsed local HTML screenshot result. */
export interface HtmlScreenshotOutput {
    outputPath: string;
    width: number;
    height: number;
    pageHeight?: number;
}
/** Parse one numbered upstream location line (`N. position label x1: ..., ...`). */
export declare function parseLocationLine(line: string): LocatedElement | undefined;
/** Parse ground/detect stdout; non-empty unknown lines are an output contract failure. */
export declare function parseLocationOutput(stdout: string): LocatedElement[];
/** Parse the crop CLI's `wrote <path> (WxH)` line and clamp note. */
export declare function parseCropOutput(stdout: string, stderr: string): CropOutput;
/** Parse the pinned trace CLI's written-file summary. */
export declare function parseTraceOutput(stdout: string): TraceOutput;
/** Parse the complete `pixel_diff.py` stdout contract. */
export declare function parsePixelDiffOutput(stdout: string): PixelDiffOutput;
/** Parse the complete `extract_fg.py` stdout contract. */
export declare function parseExtractForegroundOutput(stdout: string): ExtractForegroundOutput;
/** Parse palette and candidate modes from `dominant_colors.py`. */
export declare function parseDominantColorsOutput(stdout: string): DominantColorsOutput;
/** Parse the local Chrome screenshot summary. */
export declare function parseHtmlScreenshotOutput(stdout: string): HtmlScreenshotOutput;
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
        mode: string;
    }>;
    private runPythonCode;
    /** Draw validated pixel boxes and labels into a PNG preview with Pillow. */
    renderAnnotatedPreview(imagePath: string, outputPath: string, elements: readonly LocatedElement[], options: {
        signal: AbortSignal;
    }): Promise<void>;
    /** Locate the same optional Chrome-family browser the pinned HTML script uses. */
    findChrome(options: {
        signal: AbortSignal;
    }): Promise<string | undefined>;
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