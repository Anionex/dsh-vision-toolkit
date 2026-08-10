/**
 * Model-facing native tools. Every definition projects one structured runtime
 * operation, declares replay-safe file locations, and preserves canonical
 * result metadata for the optional Web client without changing Headless or
 * model-visible semantics.
 * @module dsh-vision-toolkit/tools
 */
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import { VisionToolkitRuntime } from './runtime.ts';
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