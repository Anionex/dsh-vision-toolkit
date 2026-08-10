/**
 * Model-facing native tools. Every definition projects one structured runtime
 * operation, declares replay-safe file locations, and preserves canonical
 * result metadata for the optional Web client without changing Headless or
 * model-visible semantics.
 * @module dsh-vision-toolkit/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { VisionToolkitRuntime } from './runtime.ts';
/** Build the complete P0/P1 tool set from one prepared runtime. */
export declare function createVisionTools(runtime: VisionToolkitRuntime): ReturnType<typeof defineTool>[];
//# sourceMappingURL=tools.d.ts.map