/**
 * Model-facing tool definitions. Every tool is a thin structured adapter over
 * the runtime; no tool parses upstream text itself and no tool bypasses the
 * path fence, limits, credential resolution, or deadline owned by the runtime.
 * @module dsh-vision-toolkit/tools
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  VisionToolkitRuntime,
  type CropRequest,
  type GlanceRequest,
  type LocateRequest,
  type ToolCallOptions,
  type TraceRequest,
} from './runtime.ts'
import { PLUGIN_VERSION, UPSTREAM_COMMIT, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from './version.ts'

const renderJson = (_args: unknown, value: unknown): ContentBlock[] => [{
  type: 'text',
  text: JSON.stringify(value, null, 2),
}]

const WORKSPACE_NOTE = 'All image paths are resolved against the session workspace and must stay inside it (or an allowedDirs entry).'
const REGION_NOTE = 'Pixel box as four integers X1,Y1,X2,Y2, e.g. "100,50,400,300".'
const TIMEOUT_NOTE = 'Override the plugin timeoutMs for this call (positive integer, max 600000).'

/** Resolve the caller workspace exactly like first-party fs/bash tools. */
function sessionWorkspace(exec: ToolRunContext): string {
  return exec.agent?.session.header.cwd ?? process.cwd()
}

/** Stable session key used by the runtime's per-session concurrency gate. */
function sessionId(exec: ToolRunContext): string | undefined {
  const id = exec.agent?.session.header.id
  return id === undefined ? undefined : String(id)
}

/** Runtime call options derived once so exact optional properties stay absent. */
function callOptions(exec: ToolRunContext, timeoutMs: number | undefined): ToolCallOptions {
  const id = sessionId(exec)
  return {
    signal: exec.signal,
    workspace: sessionWorkspace(exec),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(id === undefined ? {} : { sessionId: id }),
  }
}

const boxSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x1: { type: 'integer', required: true },
    y1: { type: 'integer', required: true },
    x2: { type: 'integer', required: true },
    y2: { type: 'integer', required: true },
  },
} as const satisfies ValueSchemaSpec

const imageInfoSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    format: { type: 'string', required: true },
  },
} as const satisfies ValueSchemaSpec

const locatedMatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string', required: true },
    box: boxSchema,
  },
} as const satisfies ValueSchemaSpec

/**
 * Build the six registered tools. The version tool works before the runtime
 * is fully prepared; the five capability tools require a prepared runtime.
 */
export function createVisionTools(runtime: VisionToolkitRuntime): ReturnType<typeof defineTool>[] {
  return [
    defineTool({
      name: 'vision_glance',
      description: 'Describe, answer a question about, OCR, or compare images with the configured vision model. '
        + 'Pass several images to compare them in ONE call. Use `region` to zoom into a small area before asking. '
        + 'The answer is plain text from the vision model; coordinates are not returned by this tool — use vision_ground/vision_detect for locations. '
        + WORKSPACE_NOTE,
      parameters: {
        images: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description: 'One or more image paths (relative to the workspace). Pass several for comparison in one call.',
        },
        query: { type: 'string', description: 'Targeted question about the image(s); omit for a detailed description.' },
        ocr: { type: 'boolean', description: 'Transcribe every visible text verbatim instead of describing; mutually exclusive with query.' },
        region: { type: 'string', description: `${REGION_NOTE} Works with exactly one image; only the crop is sent to the model.` },
        timeoutMs: { type: 'integer', description: TIMEOUT_NOTE },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            images: { type: 'array', items: imageInfoSchema, required: true },
            mode: { type: 'string', enum: ['describe', 'qa', 'ocr'], required: true },
            answer: { type: 'string', required: true },
            truncated: { type: 'boolean', required: true },
          },
        },
        render: renderJson,
      },
      async execute(args: GlanceArgs, exec) {
        const request: GlanceRequest = {
          images: args.images,
          ...(args.query !== undefined ? { query: args.query } : {}),
          ...(args.ocr === true ? { ocr: true } : {}),
          ...(args.region !== undefined ? { region: args.region } : {}),
        }
        return runtime.glance(request, callOptions(exec, args.timeoutMs))
      },
      isConcurrencySafe: () => true,
    }),
    defineTool({
      name: 'vision_ground',
      description: 'Locate one named target in an image and return pixel bounding boxes in the original image. '
        + 'Returned coordinates can be fed directly to vision_crop (same X1,Y1,X2,Y2 format). '
        + 'When several boxes come back, the target matched more than one element; narrow the description. '
        + WORKSPACE_NOTE,
      parameters: {
        image: { type: 'string', required: true, description: 'Image path (relative to the workspace).' },
        target: { type: 'string', required: true, description: 'Description of the particular thing to locate, e.g. "the send button".' },
        region: { type: 'string', description: `${REGION_NOTE} Search only this box; output stays in original-image coordinates.` },
        timeoutMs: { type: 'integer', description: TIMEOUT_NOTE },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            target: { type: 'string', required: true },
            imageWidth: { type: 'integer', required: true },
            imageHeight: { type: 'integer', required: true },
            matches: { type: 'array', items: locatedMatchSchema, required: true },
          },
        },
        render: renderJson,
      },
      async execute(args: GroundArgs, exec) {
        const request: LocateRequest = {
          image: args.image,
          target: args.target,
          ...(args.region !== undefined ? { region: args.region } : {}),
        }
        return runtime.ground(request, callOptions(exec, args.timeoutMs))
      },
      isConcurrencySafe: () => true,
    }),
    defineTool({
      name: 'vision_detect',
      description: 'Inventory every element of a kind in an image (or one region) and return numbered pixel bounding boxes. '
        + 'Use a kind ("buttons", "icons", "input fields") rather than one particular thing; for one named thing use vision_ground. '
        + WORKSPACE_NOTE,
      parameters: {
        image: { type: 'string', required: true, description: 'Image path (relative to the workspace).' },
        category: { type: 'string', description: 'Element kind to inventory, e.g. "buttons"; defaults to all UI elements.' },
        region: { type: 'string', description: `${REGION_NOTE} Inventory only this box; output stays in original-image coordinates.` },
        timeoutMs: { type: 'integer', description: TIMEOUT_NOTE },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            category: { type: 'string', required: true },
            imageWidth: { type: 'integer', required: true },
            imageHeight: { type: 'integer', required: true },
            elements: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  index: { type: 'integer', required: true },
                  label: { type: 'string', required: true },
                  box: boxSchema,
                },
              },
              required: true,
            },
          },
        },
        render: renderJson,
      },
      async execute(args: DetectArgs, exec) {
        const request: LocateRequest = {
          image: args.image,
          target: args.category ?? 'every distinct UI element — include the exact visible text in each label',
          ...(args.region !== undefined ? { region: args.region } : {}),
        }
        return runtime.detect(request, callOptions(exec, args.timeoutMs))
      },
      isConcurrencySafe: () => true,
    }),
    defineTool({
      name: 'vision_trace',
      description: 'Trace a flat, high-contrast raster graphic (icon, logo, diagram) into an editable SVG with the pinned upstream vtracer pipeline. '
        + 'Returns the SVG file path, path count, traced scale, and byte size. '
        + 'Text is geometry to this tool; use vision_glance with ocr when the text matters. '
        + WORKSPACE_NOTE,
      parameters: {
        image: { type: 'string', required: true, description: 'Image path (relative to the workspace).' },
        region: { type: 'string', description: `${REGION_NOTE} Trace only this box.` },
        scale: { type: 'integer', description: 'Analyze at N times source resolution (1-16); output coordinates stay in the original image grid.' },
        color: { type: 'boolean', description: 'Sample and preserve the foreground color instead of a default.' },
        polygon: { type: 'boolean', description: 'Use polygon mode for boxy diagrams; omit for spline mode on curved graphics.' },
        output: { type: 'string', description: 'Output filename inside the plugin output directory; must end in .svg.' },
        timeoutMs: { type: 'integer', description: TIMEOUT_NOTE },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            imageWidth: { type: 'integer', required: true },
            imageHeight: { type: 'integer', required: true },
            outputPath: { type: 'string', required: true },
            mimeType: { type: 'string', const: 'image/svg+xml', required: true },
            geometry: {
              type: 'object',
              additionalProperties: false,
              required: true,
              properties: {
                status: { type: 'string', enum: ['generated', 'empty'], required: true },
                pathCount: { type: 'integer', required: true },
                tracedScale: { type: 'integer', required: true },
                bytes: { type: 'integer', required: true },
              },
            },
            warning: { type: 'string' },
          },
        },
        render: renderJson,
      },
      async execute(args: TraceArgs, exec) {
        const request: TraceRequest = {
          image: args.image,
          ...(args.region !== undefined ? { region: args.region } : {}),
          ...(args.scale !== undefined ? { scale: args.scale } : {}),
          ...(args.color === true ? { color: true } : {}),
          ...(args.polygon === true ? { polygon: true } : {}),
          ...(args.output !== undefined ? { output: args.output } : {}),
        }
        return runtime.trace(request, callOptions(exec, args.timeoutMs))
      },
    }),
    defineTool({
      name: 'vision_crop',
      description: 'Cut a pixel box out of an image into its own PNG/JPEG file (local, no vision API). '
        + 'Coordinates are the same X1,Y1,X2,Y2 boxes vision_ground/vision_detect return and are clamped to the image bounds. '
        + 'Use --scale 2-4 for small icons before vision_ground/vision_trace. ' + WORKSPACE_NOTE,
      parameters: {
        image: { type: 'string', required: true, description: 'Image path (relative to the workspace).' },
        region: { type: 'string', required: true, description: `${REGION_NOTE} Required; the box to cut out.` },
        scale: { type: 'integer', description: 'Upscale the cut-out N times (LANCZOS) before writing; 1-8, default 1.' },
        output: { type: 'string', description: 'Output filename inside the plugin output directory; must end in .png/.jpg/.jpeg.' },
        timeoutMs: { type: 'integer', description: TIMEOUT_NOTE },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            imageWidth: { type: 'integer', required: true },
            imageHeight: { type: 'integer', required: true },
            region: boxSchema,
            outputPath: { type: 'string', required: true },
            mimeType: { type: 'string', enum: ['image/png', 'image/jpeg'], required: true },
            width: { type: 'integer', required: true },
            height: { type: 'integer', required: true },
            clamped: { type: 'boolean', required: true },
            note: { type: 'string' },
          },
        },
        render: renderJson,
      },
      async execute(args: CropArgs, exec) {
        const request: CropRequest = {
          image: args.image,
          region: args.region,
          ...(args.scale !== undefined ? { scale: args.scale } : {}),
          ...(args.output !== undefined ? { output: args.output } : {}),
        }
        return runtime.crop(request, callOptions(exec, args.timeoutMs))
      },
    }),
    defineTool({
      name: 'vision_toolkit_version',
      description: 'Report the DSH Vision Toolkit plugin and pinned upstream agent-vision-toolkit version facts, plus the local checkout and Python runtime. '
        + 'Read-only; makes no vision API call.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            pluginVersion: { type: 'string', required: true },
            upstream: {
              type: 'object',
              additionalProperties: false,
              properties: {
                repository: { type: 'string', required: true },
                version: { type: 'string', required: true },
                commit: { type: 'string', required: true },
                path: { type: 'string', required: true },
                source: { type: 'string', enum: ['managed', 'external'], required: true },
              },
            },
            checkoutVersion: { type: 'string', required: true },
            python: { type: 'string', required: true },
            pythonVersion: { type: 'string', required: true },
            dependencies: { type: 'json', required: true },
          },
        },
        render: renderJson,
      },
      async execute(_args: Record<string, never>, _exec: ToolRunContext) {
        const info = runtime.upstreamVersion
        const checkoutVersion = await runtime.checkoutVersion()
        return {
          pluginVersion: PLUGIN_VERSION,
          upstream: {
            repository: UPSTREAM_REPOSITORY,
            version: UPSTREAM_VERSION,
            commit: UPSTREAM_COMMIT,
            path: info.path,
            source: info.source,
          },
          checkoutVersion,
          python: runtime.python(),
          pythonVersion: info.pythonVersion,
          dependencies: info.dependencies,
        }
      },
    }),
  ]
}

/** Parsed tool argument shapes. */
interface GlanceArgs {
  images: string[]
  query?: string
  ocr?: boolean
  region?: string
  timeoutMs?: number
}

interface GroundArgs {
  image: string
  target: string
  region?: string
  timeoutMs?: number
}

interface DetectArgs {
  image: string
  category?: string
  region?: string
  timeoutMs?: number
}

interface TraceArgs {
  image: string
  region?: string
  scale?: number
  color?: boolean
  polygon?: boolean
  output?: string
  timeoutMs?: number
}

interface CropArgs {
  image: string
  region: string
  scale?: number
  output?: string
  timeoutMs?: number
}
