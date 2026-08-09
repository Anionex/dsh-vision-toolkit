/**
 * Vision Toolkit runtime: structured requests in, structured results out.
 * It validates paths and limits, resolves the credential per operation, holds
 * a bounded concurrency slot, synthesizes cancellation + timeout into the
 * upstream process signal, and classifies failures for the model.
 * @module dsh-vision-toolkit/runtime
 */

import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Context } from 'cordis'
import type { ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ResolvedVisionToolkitConfig } from './config.ts'
import { VisionToolkitError } from './errors.ts'
import {
  assertDistinctOutput,
  createPathPolicy,
  resolveInputFile,
  resolveOutputFile,
  type PathPolicy,
} from './paths.ts'
import {
  parseCropOutput,
  parseLocationOutput,
  parseTraceReport,
  UpstreamAdapter,
  type CropOutput,
  type LocatedElement,
  type TraceReport,
  type UpstreamEnvironment,
  type UpstreamTool,
  type UpstreamVersionInfo,
} from './upstream.ts'

/** Per-invocation cancellation and timeout facts. */
export interface Deadline {
  signal: AbortSignal
  /** True when the deadline timer fired. */
  timedOut: boolean
  /** True when the caller signal fired first. */
  cancelled: boolean
  /** Clear the timer and caller listener. */
  cleanup(): void
}

/**
 * Combine a caller abort signal with a hard timeout so the upstream process
 * tree receives one signal and the failure can be classified precisely.
 * @param signal - caller-owned cancellation.
 * @param timeoutMs - execution budget in milliseconds.
 * @returns fused deadline handles.
 */
export function createDeadline(signal: AbortSignal, timeoutMs: number): Deadline {
  const controller = new AbortController()
  const state = { timedOut: false, cancelled: false }
  const onCallerAbort = (): void => {
    state.cancelled = true
    controller.abort()
  }
  if (signal.aborted) {
    state.cancelled = true
    controller.abort()
  } else {
    signal.addEventListener('abort', onCallerAbort, { once: true })
  }
  const timer = setTimeout(() => {
    state.timedOut = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    get timedOut(): boolean { return state.timedOut },
    get cancelled(): boolean { return state.cancelled },
    cleanup(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', onCallerAbort)
    },
  }
}

/** Bounded concurrency gate; waiting respects the caller signal. */
export class Semaphore {
  private active = 0
  private readonly waiters: Array<{
    resolve: () => void
    reject: (error: unknown) => void
    signal: AbortSignal
    onAbort: () => void
  }> = []

  constructor(private readonly limit: number) {}

  /** Acquire one slot, aborting while queued when `signal` fires. */
  async acquire(signal: AbortSignal): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        signal,
        onAbort: () => {},
      }
      entry.onAbort = (): void => {
        const index = this.waiters.indexOf(entry)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new VisionToolkitError('cancelled', 'vision-toolkit: cancelled while waiting for a concurrency slot'))
      }
      this.waiters.push(entry)
      if (signal.aborted) {
        entry.onAbort()
      } else {
        signal.addEventListener('abort', entry.onAbort, { once: true })
      }
    })
  }

  /** Release one slot and wake the longest-waiting caller. */
  release(): void {
    this.active -= 1
    const next = this.waiters.shift()
    if (next !== undefined) {
      next.signal.removeEventListener('abort', next.onAbort)
      next.resolve()
    }
  }
}

/** Structured input for one glance call. */
export interface GlanceRequest {
  images: string[]
  query?: string
  ocr?: boolean
  region?: string
}

/** Structured glance result — the description is the model-visible answer. */
export interface GlanceResult {
  images: Array<{ path: string; bytes: number }>
  mode: 'describe' | 'qa' | 'ocr'
  answer: string
  truncated: boolean
}

/** Structured input for ground/detect. */
export interface LocateRequest {
  image: string
  target: string
  region?: string
}

/** One located element with an optional upstream label. */
export interface LocateMatch {
  label: string
  box: { x1: number; y1: number; x2: number; y2: number }
}

/** Structured ground result. */
export interface GroundResult {
  target: string
  imageWidth: number
  imageHeight: number
  matches: LocateMatch[]
}

/** Structured detect result. */
export interface DetectResult {
  category: string
  imageWidth: number
  imageHeight: number
  elements: Array<{ index: number; label: string; box: { x1: number; y1: number; x2: number; y2: number } }>
}

/** Structured crop request. */
export interface CropRequest {
  image: string
  region: string
  scale?: number
  output?: string
}

/** Structured crop result. */
export interface CropResult {
  imageWidth: number
  imageHeight: number
  region: { x1: number; y1: number; x2: number; y2: number }
  outputPath: string
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  clamped: boolean
  note?: string
}

/** trace mode flags passed through to the upstream CLI. */
export type TraceMode = 'deterministic' | 'perceive' | 'synthesize' | 'review'

/** Structured trace request. */
export interface TraceRequest {
  image: string
  region?: string
  scale?: number
  strokeWidth?: number
  color?: boolean
  filled?: boolean
  outline?: boolean
  mode?: TraceMode
  requireProduction?: boolean
  output?: string
}

/** Structured trace result. */
export interface TraceResult {
  imageWidth: number
  imageHeight: number
  outputPath: string
  mimeType: 'image/svg+xml'
  geometry: {
    status: string
    confidence: JsonValue
    primitiveCount?: number
    representation?: string
    strokeWidth?: number
    pixelFit?: number
  }
  perception?: { label?: string; confidence?: JsonValue }
  warning?: string
}

/** Shared per-call execution options. */
export interface ToolCallOptions {
  signal: AbortSignal
  timeoutMs?: number
  workspace: string
}

/** Result view returned by the runtime's upstream runner. */
interface UpstreamRunView {
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

const REGION_PATTERN = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/

/** Parse a four-integer pixel box; a malformed box is an input error. */
export function parseRegion(region: string): { x1: number; y1: number; x2: number; y2: number } {
  const match = REGION_PATTERN.exec(region)
  if (match === null) {
    throw new VisionToolkitError('input', 'region must be four integers: X1,Y1,X2,Y2 (pixels)')
  }
  return {
    x1: Number(match[1]),
    y1: Number(match[2]),
    x2: Number(match[3]),
    y2: Number(match[4]),
  }
}

const SUPPORTED_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
])

/**
 * Runtime facade used by every tool; tools never call the upstream adapter
 * directly, and the future P2 service will consume the same methods.
 */
export class VisionToolkitRuntime {
  private readonly semaphore: Semaphore
  private readonly adapter: UpstreamAdapter

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedVisionToolkitConfig,
    adapter?: UpstreamAdapter,
  ) {
    this.semaphore = new Semaphore(config.concurrency)
    this.adapter = adapter ?? new UpstreamAdapter(ctx, config)
  }

  /** Pinned upstream identity. */
  get upstreamVersion(): UpstreamVersionInfo {
    return this.adapter.versionInfo
  }

  /** Resolve the configured credential at the operation boundary. */
  async resolveVisionEnv(): Promise<UpstreamEnvironment> {
    const resolved: ResolvedCredential | undefined = await this.ctx.credentials.resolve(this.config.provider.credential)
    if (resolved === undefined) {
      throw new VisionToolkitError(
        'config',
        `credential ${this.config.provider.credential} is not configured; set it through DSH credentials`,
      )
    }
    return {
      VISION_API_KEY: resolved.value,
      VISION_BASE_URL: this.config.provider.baseUrl,
      VISION_MODEL: this.config.provider.model,
      LANG: this.config.language,
    }
  }

  /**
   * Run one bounded tool request. Concurrency, credential resolution, path
   * fencing, and the deadline all live here, not in the tool definitions.
   */
  private async runBounded<T>(request: () => Promise<T>, options: ToolCallOptions): Promise<T> {
    await this.semaphore.acquire(options.signal)
    try {
      return await request()
    } finally {
      this.semaphore.release()
    }
  }

  /** Resolve the path fence for one invocation's workspace. */
  private async pathPolicy(workspace: string): Promise<PathPolicy> {
    return createPathPolicy(workspace, this.config.allowedDirs)
  }

  /** Validate one input image against fence and size limits. */
  private async validateImage(raw: string, policy: PathPolicy): Promise<{ path: string; bytes: number }> {
    const image = await resolveInputFile(raw, policy)
    if (image.bytes > this.config.maxImageBytes) {
      throw new VisionToolkitError(
        'capacity',
        `image is ${image.bytes} bytes, exceeding maxImageBytes ${this.config.maxImageBytes}`,
      )
    }
    return image
  }

  /** Run the upstream adapter inside the invocation deadline. */
  private async runUpstream(
    tool: UpstreamTool,
    args: readonly string[],
    options: ToolCallOptions,
    env: UpstreamEnvironment,
    workspace: string,
  ): Promise<UpstreamRunView> {
    const deadline = createDeadline(options.signal, options.timeoutMs ?? this.config.timeoutMs)
    try {
      const result = await this.adapter.run(tool, args, {
        signal: deadline.signal,
        workspace,
        env,
      })
      if (result.outcome.exitCode !== 0) {
        throw this.adapter.classifyFailure(tool, result, {
          timedOut: deadline.timedOut,
          cancelled: deadline.cancelled,
        })
      }
      return result
    } catch (error) {
      if (error instanceof VisionToolkitError) throw error
      const deadlineError = deadline.cancelled
        ? new VisionToolkitError('cancelled', `${tool}: cancelled`)
        : deadline.timedOut
          ? new VisionToolkitError('cancelled', `${tool}: timed out`)
          : new VisionToolkitError('service', `${tool}: upstream execution failed`)
      throw deadlineError
    } finally {
      deadline.cleanup()
    }
  }

  /** glance: describe, targeted QA, OCR, or multi-image comparison. */
  async glance(request: GlanceRequest, options: ToolCallOptions): Promise<GlanceResult> {
    return this.runBounded(async () => {
      if (request.images.length === 0) {
        throw new VisionToolkitError('input', 'glance requires at least one image')
      }
      if (request.query !== undefined && request.ocr === true) {
        throw new VisionToolkitError('input', 'glance: query and ocr are mutually exclusive')
      }
      if (request.region !== undefined && request.images.length > 1) {
        throw new VisionToolkitError('input', 'glance: region works with exactly one image')
      }
      if (request.region !== undefined) parseRegion(request.region)
      const policy = await this.pathPolicy(options.workspace)
      const images: Array<{ path: string; bytes: number }> = []
      for (const raw of request.images) {
        images.push(await this.validateImage(raw, policy))
      }
      const env = await this.resolveVisionEnv()
      const args = [
        ...images.map(image => image.path),
        ...(request.region !== undefined ? ['--region', request.region] : []),
        ...(request.ocr === true ? ['--ocr'] : []),
        ...(request.query !== undefined ? ['-q', request.query] : []),
      ]
      const result = await this.runUpstream('glance', args, options, env, policy.workspace)
      const answer = result.stdout.trim()
      if (answer.length === 0) {
        throw new VisionToolkitError('output', 'glance: vision API returned an empty description')
      }
      const mode = request.ocr === true ? 'ocr' : request.query !== undefined ? 'qa' : 'describe'
      return {
        images: images.map(image => ({ path: image.path, bytes: image.bytes })),
        mode,
        answer,
        truncated: result.stdoutTruncated,
      }
    }, options)
  }

  /** Shared locate path for ground and detect. */
  private async locate(request: LocateRequest, options: ToolCallOptions, tool: 'ground' | 'detect'): Promise<{
    policy: PathPolicy
    image: { path: string; bytes: number }
    size: { width: number; height: number }
    elements: LocatedElement[]
  }> {
    if (request.target.trim().length === 0) {
      throw new VisionToolkitError('input', 'target must not be empty')
    }
    if (request.region !== undefined) parseRegion(request.region)
    const policy = await this.pathPolicy(options.workspace)
    const image = await this.validateImage(request.image, policy)
    const deadline = createDeadline(options.signal, options.timeoutMs ?? this.config.timeoutMs)
    let size: { width: number; height: number }
    try {
      size = await this.adapter.probeImageSize(image.path, {
        signal: deadline.signal,
        workspace: policy.workspace,
      })
    } finally {
      deadline.cleanup()
    }
    const env = await this.resolveVisionEnv()
    const args = [
      image.path,
      request.target,
      ...(request.region !== undefined ? ['--region', request.region] : []),
    ]
    const result = await this.runUpstream(tool, args, options, env, policy.workspace)
    return { policy, image, size, elements: parseLocationOutput(result.stdout) }
  }

  /** ground: locate one named target and return pixel boxes. */
  async ground(request: LocateRequest, options: ToolCallOptions): Promise<GroundResult> {
    return this.runBounded(async () => {
      const { size, elements } = await this.locate(request, options, 'ground')
      const matches: LocateMatch[] = elements.map(element => ({
        label: element.label ?? request.target,
        box: element.box,
      }))
      return {
        target: request.target,
        imageWidth: size.width,
        imageHeight: size.height,
        matches,
      }
    }, options)
  }

  /** detect: inventory every instance of a kind. */
  async detect(request: LocateRequest, options: ToolCallOptions): Promise<DetectResult> {
    return this.runBounded(async () => {
      const { size, elements } = await this.locate(request, options, 'detect')
      return {
        category: request.target,
        imageWidth: size.width,
        imageHeight: size.height,
        elements: elements.map((element, index) => ({
          index: index + 1,
          label: element.label ?? request.target,
          box: element.box,
        })),
      }
    }, options)
  }

  /** crop: cut a pixel box into its own image file. */
  async crop(request: CropRequest, options: ToolCallOptions): Promise<CropResult> {
    return this.runBounded(async () => {
      const region = parseRegion(request.region)
      if (request.scale !== undefined && (!Number.isInteger(request.scale) || request.scale < 1 || request.scale > 8)) {
        throw new VisionToolkitError('input', 'crop: scale must be an integer between 1 and 8')
      }
      const policy = await this.pathPolicy(options.workspace)
      const image = await this.validateImage(request.image, policy)
      const extension = extname(image.path).toLowerCase()
      const stem = basename(image.path, extension)
      const output = resolveOutputFile(
        request.output,
        policy,
        request.scale !== undefined && request.scale > 1 ? `${stem}.crop@${request.scale}x.png` : `${stem}.crop.png`,
        ['.png', '.jpg', '.jpeg'],
      )
      assertDistinctOutput(image.path, output)
      const deadline = createDeadline(options.signal, options.timeoutMs ?? this.config.timeoutMs)
      let size: { width: number; height: number }
      try {
        size = await this.adapter.probeImageSize(image.path, {
          signal: deadline.signal,
          workspace: policy.workspace,
        })
      } finally {
        deadline.cleanup()
      }
      const env = await this.resolveVisionEnv()
      const args = [
        image.path,
        '--region',
        request.region,
        '-o',
        output,
        ...(request.scale !== undefined ? ['--scale', String(request.scale)] : []),
      ]
      const result = await this.runUpstream('crop', args, options, env, policy.workspace)
      const parsed: CropOutput = parseCropOutput(result.stdout, result.stderr)
      const actualPath = parsed.outputPath
      try {
        await readFile(actualPath)
      } catch (error) {
        throw new VisionToolkitError('output', `crop: output file was not created: ${actualPath}`, { cause: error })
      }
      const mimeType: CropResult['mimeType'] =
        (SUPPORTED_MIME.get(extname(actualPath).toLowerCase()) as CropResult['mimeType'] | undefined) ?? 'image/png'
      return {
        imageWidth: size.width,
        imageHeight: size.height,
        region,
        outputPath: actualPath,
        mimeType,
        width: parsed.width,
        height: parsed.height,
        clamped: parsed.clamped,
        ...(parsed.note !== undefined ? { note: parsed.note } : {}),
      }
    }, options)
  }

  /** trace: recover SVG geometry from a flat graphic. */
  async trace(request: TraceRequest, options: ToolCallOptions): Promise<TraceResult> {
    return this.runBounded(async () => {
      if (request.region !== undefined) parseRegion(request.region)
      if (request.scale !== undefined && (!Number.isInteger(request.scale) || request.scale < 1 || request.scale > 8)) {
        throw new VisionToolkitError('input', 'trace: scale must be an integer between 1 and 8')
      }
      if (request.strokeWidth !== undefined && (!Number.isFinite(request.strokeWidth) || request.strokeWidth <= 0)) {
        throw new VisionToolkitError('input', 'trace: strokeWidth must be a positive number')
      }
      const policy = await this.pathPolicy(options.workspace)
      const image = await this.validateImage(request.image, policy)
      const extension = extname(image.path).toLowerCase()
      const stem = basename(image.path, extension)
      const output = resolveOutputFile(request.output, policy, `${stem}.svg`, ['.svg'])
      assertDistinctOutput(image.path, output)
      const reportPath = join(policy.outputDir, `.trace-report-${randomUUID()}.json`)
      const args = [
        image.path,
        ...(request.region !== undefined ? ['--region', request.region] : []),
        ...(request.scale !== undefined ? ['--scale', String(request.scale)] : []),
        ...(request.strokeWidth !== undefined ? ['--stroke-width', String(request.strokeWidth)] : []),
        ...(request.color === true ? ['--color'] : []),
        ...(request.filled === true ? ['--filled'] : []),
        ...(request.outline === true ? ['--outline'] : []),
        ...(request.mode === 'perceive' ? ['--llm-perceive'] : []),
        ...(request.mode === 'synthesize' ? ['--llm-synthesize'] : []),
        ...(request.mode === 'review' ? ['--llm-review'] : []),
        ...(request.requireProduction === true ? ['--require-production'] : []),
        '-o',
        output,
        '--report',
        reportPath,
      ]
      const env = await this.resolveVisionEnv()
      let result: UpstreamRunView | undefined
      let report: TraceReport
      try {
        result = await this.runUpstream('trace', args, options, env, policy.workspace)
        report = parseTraceReport(await readFile(reportPath, 'utf8'))
      } catch (error) {
        if (error instanceof VisionToolkitError && error.code === 'service' && result?.stderr.includes('production gate failed')) {
          throw new VisionToolkitError('output', error.message)
        }
        throw error
      } finally {
        await rm(reportPath, { force: true }).catch(() => {})
      }
      const svg = await readFile(output, 'utf8').catch(() => '')
      if (!svg.includes('<svg') || !svg.includes('</svg>')) {
        throw new VisionToolkitError('output', `trace: output SVG is not a parseable document: ${output}`)
      }
      const runResult = result as UpstreamRunView
      const warningMatch = /trace:\s*warning:\s*(.+)$/m.exec(runResult.stderr)
      const [width, height] = report.logicalSize
      return {
        imageWidth: width,
        imageHeight: height,
        outputPath: output,
        mimeType: 'image/svg+xml',
        geometry: {
          status: report.geometry.status,
          confidence: report.geometry.confidence as JsonValue,
          ...(report.geometry.primitiveCount !== undefined ? { primitiveCount: report.geometry.primitiveCount } : {}),
          ...(report.geometry.representation !== undefined ? { representation: report.geometry.representation } : {}),
          ...(report.geometry.strokeWidth !== undefined ? { strokeWidth: report.geometry.strokeWidth } : {}),
          ...(report.geometry.pixelFit !== undefined ? { pixelFit: report.geometry.pixelFit } : {}),
        },
        ...(report.perception !== undefined
          ? {
            perception: {
              ...(report.perception.label !== undefined ? { label: report.perception.label } : {}),
              ...(report.perception.confidence !== undefined
                ? { confidence: report.perception.confidence as JsonValue }
                : {}),
            },
          }
          : {}),
        ...(warningMatch !== null ? { warning: warningMatch[1]?.trim() ?? 'upstream reported a warning' } : {}),
      }
    }, options)
  }

  /** Report the upstream checkout's own version marker (or the packaged pin). */
  async checkoutVersion(): Promise<string> {
    return this.adapter.readCheckoutVersion()
  }

  /** The Python executable used to launch upstream CLIs. */
  python(): string {
    return this.config.runtime.python
  }
}
