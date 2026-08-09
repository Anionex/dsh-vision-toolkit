/**
 * Model-facing tool definitions. Every tool is a thin structured adapter over
 * the runtime; no tool parses upstream text itself and no tool bypasses the
 * path fence, limits, credential resolution, or deadline owned by the runtime.
 * @module dsh-vision-toolkit/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { VisionToolkitRuntime } from './runtime.ts';
/**
 * Build the six registered tools. The version tool works before the runtime
 * is fully prepared; the five capability tools require a prepared runtime.
 */
export declare function createVisionTools(runtime: VisionToolkitRuntime): ReturnType<typeof defineTool>[];
//# sourceMappingURL=tools.d.ts.map