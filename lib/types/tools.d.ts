/**
 * Model-facing native tools. Every definition projects one structured runtime
 * operation, declares replay-safe file locations, and preserves canonical
 * result metadata for the optional Web client without changing Headless or
 * model-visible semantics.
 * @module dsh-vision-toolkit/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { VisionToolkitRuntime } from './runtime.ts';
/**
 * A value that round-trips through JSON without loss, as the host transports it
 * through `presentationMeta`. DSH 0.1.2 stopped exporting this type from
 * `@deepseek-ai/dsh-tools`, and 0.1.5 keeps it in `@deepseek-ai/dsh-util-values`,
 * a package that does not exist before 0.1.2-alpha.2, so no single specifier
 * covers every release line this package declares. Both homes declare the
 * identical structural union, so redeclaring it here costs nothing and lets old
 * and new hosts compile against the same contract.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
/** Canonical names shared by registration, bootstrap guidance, and tests. */
export declare const VISION_TOOL_NAMES: {
    readonly glance: "vision_glance";
    readonly ground: "vision_ground";
    readonly detect: "vision_detect";
    readonly trace: "vision_trace";
    readonly crop: "vision_crop";
    readonly pixelDiff: "vision_pixel_diff";
    readonly longScreenshotOcr: "vision_long_screenshot_ocr";
    readonly extractForeground: "vision_extract_foreground";
    readonly dominantColors: "vision_dominant_colors";
    readonly htmlScreenshot: "vision_html_screenshot";
};
/** Runtime lookup accepted by tools so Settings can atomically swap generations. */
export type VisionToolkitRuntimeSource = VisionToolkitRuntime | (() => VisionToolkitRuntime);
/** Browser-only metadata projector; the model-visible value remains unchanged. */
export type VisionToolkitPresentationProjector = (value: JsonValue) => JsonValue;
/**
 * Build the complete P0/P1 tool set from one live runtime source.
 * @param source - Current runtime or atomic runtime lookup.
 * @param projectPresentation - Browser-only projection for Artifact capabilities.
 * @param lifecycleSignal - Plugin lifetime; aborting it cancels every active tool call.
 * @returns Native tool definitions registered as one lifecycle generation.
 */
export declare function createVisionTools(source: VisionToolkitRuntimeSource, projectPresentation?: VisionToolkitPresentationProjector, lifecycleSignal?: AbortSignal): ReturnType<typeof defineTool>[];
//# sourceMappingURL=tools.d.ts.map