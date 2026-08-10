/**
 * Structured adapter over the pinned agent-vision-toolkit snapshot. Every
 * invocation is an argv vector through DSH Subprocess, runs from a clean home
 * so upstream env files cannot override DSH configuration, and converts the
 * pinned CLI contracts into stable data.
 * @module dsh-vision-toolkit/upstream
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from 'cordis'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { ResolvedVisionToolkitConfig } from './config.ts'
import { VisionToolkitError, upstreamFailureMessage } from './errors.ts'
import {
  displayCommand,
  prepareUpstreamRuntime,
  type PreparedUpstreamRuntime,
} from './runtime-install.ts'
import { UPSTREAM_COMMIT, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from './version.ts'

/** One upstream CLI exposed by the P0 runtime. */
export type UpstreamTool = 'glance' | 'ground' | 'detect' | 'crop' | 'trace'

/** Vision configuration forwarded only to upstream commands that call the API. */
export interface UpstreamEnvironment {
  VISION_API_KEY: string
  VISION_BASE_URL: string
  VISION_MODEL: string
  LANG: 'zh' | 'en'
}

/** Pinned upstream identity plus prepared runtime facts. */
export interface UpstreamVersionInfo {
  repository: string
  version: string
  commit: string
  path: string
  source: 'managed' | 'external'
  python: string
  pythonVersion: string
  dependencies: Record<string, string>
}

/** Settled upstream process facts plus bounded output. */
export interface UpstreamRunResult {
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  outcome: SubprocessOutcome
}

/** Pixel box in original-image coordinates. */
export interface PixelBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** One ground/detect match line converted to structure. */
export interface LocatedElement {
  label?: string
  box: PixelBox
}

/** Parsed crop CLI result. */
export interface CropOutput {
  outputPath: string
  width: number
  height: number
  clamped: boolean
  note?: string
}

/** Parsed trace CLI result from the pinned vtracer implementation. */
export interface TraceOutput {
  outputPath: string
  bytes: number
  pathCount: number
  tracedScale: number
}

const BOX_SUFFIX = /x1:\s*(\d+),\s*y1:\s*(\d+),\s*x2:\s*(\d+),\s*y2:\s*(\d+)\s*$/
const POSITION_WORDS = new Set([
  'top-left', 'top', 'top-right', 'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
])

/** Parse one numbered upstream location line (`N. position label x1: ..., ...`). */
export function parseLocationLine(line: string): LocatedElement | undefined {
  const match = BOX_SUFFIX.exec(line.trim())
  if (match === null) return undefined
  const box: PixelBox = {
    x1: Number(match[1]),
    y1: Number(match[2]),
    x2: Number(match[3]),
    y2: Number(match[4]),
  }
  const prefix = line.slice(0, match.index).trim()
  const numbered = /^\d+\.\s+/.exec(prefix)
  const withoutIndex = numbered === null ? prefix : prefix.slice(numbered[0].length).trim()
  const words = withoutIndex.split(/\s+/)
  const label = words.length > 0 && POSITION_WORDS.has(words[0] ?? '')
    ? words.slice(1).join(' ')
    : withoutIndex
  return { ...(label.length > 0 ? { label } : {}), box }
}

/** Parse ground/detect stdout; non-empty unknown lines are an output contract failure. */
export function parseLocationOutput(stdout: string): LocatedElement[] {
  const elements: LocatedElement[] = []
  const unknown: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed === 'no elements detected') continue
    const parsed = parseLocationLine(line)
    if (parsed === undefined) unknown.push(trimmed)
    else elements.push(parsed)
  }
  if (unknown.length > 0) {
    throw new VisionToolkitError('output', `location output contains unrecognized lines: ${unknown.slice(0, 2).join(' | ')}`)
  }
  return elements
}

/** Parse the crop CLI's `wrote <path> (WxH)` line and clamp note. */
export function parseCropOutput(stdout: string, stderr: string): CropOutput {
  const wrote = /wrote\s+(.+?)\s+\((\d+)x(\d+)\)\s*$/.exec(stdout.trim())
  if (wrote === null) {
    throw new VisionToolkitError('output', 'crop: upstream did not report a written file')
  }
  const clampedMatch = /note:\s*region\s+.*?clamped\s+to\s+([-\d,\s]+)/.exec(stderr)
  return {
    outputPath: wrote[1] ?? '',
    width: Number(wrote[2]),
    height: Number(wrote[3]),
    clamped: clampedMatch !== null,
    ...(clampedMatch !== null ? { note: `region clamped to ${clampedMatch[1]?.trim() ?? 'unknown'}` } : {}),
  }
}

/** Parse the pinned trace CLI's written-file summary. */
export function parseTraceOutput(stdout: string): TraceOutput {
  const wrote = /wrote\s+(.+?)\s+\((\d+)\s+bytes,\s+(\d+)\s+paths,\s+traced at\s+(\d+)x\)\s*$/.exec(stdout.trim())
  if (wrote === null) throw new VisionToolkitError('output', 'trace: upstream did not report a written SVG')
  return {
    outputPath: wrote[1] ?? '',
    bytes: Number(wrote[2]),
    pathCount: Number(wrote[3]),
    tracedScale: Number(wrote[4]),
  }
}

const REQUIRED_TOOLS = ['glance', 'ground', 'detect', 'crop', 'trace'] as const

/** Whether one candidate root carries every required upstream bin script. */
async function isCheckout(root: string): Promise<boolean> {
  for (const tool of REQUIRED_TOOLS) {
    try {
      const info = await stat(join(root, 'bin', tool))
      if (!info.isFile()) return false
    } catch {
      return false
    }
  }
  return true
}

/** Find the first candidate with the five pinned core CLI entrypoints. */
export async function findCheckout(candidates: readonly string[]): Promise<string> {
  const attempts: string[] = []
  for (const candidate of candidates) {
    let resolved: string
    try {
      resolved = await realpath(candidate)
    } catch {
      attempts.push(candidate)
      continue
    }
    if (await isCheckout(resolved)) return resolved
    attempts.push(`${candidate} (missing required bin scripts)`)
  }
  throw new VisionToolkitError(
    'runtime',
    `agent-vision-toolkit checkout not found; tried: ${attempts.join('; ')}; use managed mode or configure the clean pinned commit ${UPSTREAM_COMMIT}`,
  )
}

const TOOL_PATHS: Record<UpstreamTool, readonly string[]> = {
  glance: ['bin', 'glance'],
  ground: ['bin', 'ground'],
  detect: ['bin', 'detect'],
  crop: ['bin', 'crop'],
  trace: ['bin', 'trace'],
}

/** Adapter over one prepared pinned upstream runtime. */
export class UpstreamAdapter {
  private prepared: PreparedUpstreamRuntime | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedVisionToolkitConfig,
    prepared?: PreparedUpstreamRuntime,
  ) {
    this.prepared = prepared
  }

  /** Upstream identity reported to tools and logs. */
  get versionInfo(): UpstreamVersionInfo {
    const prepared = this.requirePrepared()
    return {
      repository: UPSTREAM_REPOSITORY,
      version: UPSTREAM_VERSION,
      commit: UPSTREAM_COMMIT,
      path: prepared.root,
      source: prepared.source,
      python: displayCommand(prepared.python),
      pythonVersion: prepared.pythonVersion,
      dependencies: { ...prepared.dependencies },
    }
  }

  private requirePrepared(): PreparedUpstreamRuntime {
    if (this.prepared === undefined) {
      throw new VisionToolkitError('runtime', 'agent-vision-toolkit runtime has not been prepared')
    }
    return this.prepared
  }

  /** Verify and prepare the configured source plus Python dependencies. */
  async prepare(): Promise<void> {
    this.prepared = await prepareUpstreamRuntime(this.ctx, this.config)
  }

  /** Run one upstream CLI without a shell. */
  async run(
    tool: UpstreamTool,
    args: readonly string[],
    options: {
      signal: AbortSignal
      env?: UpstreamEnvironment
    },
  ): Promise<UpstreamRunResult> {
    if (this.prepared === undefined) await this.prepare()
    const prepared = this.requirePrepared()
    const script = join(prepared.root, ...TOOL_PATHS[tool])
    const env: NodeJS.ProcessEnv = {
      HOME: prepared.cleanHome,
      USERPROFILE: prepared.cleanHome,
      LOCALAPPDATA: prepared.cleanHome,
      PYTHONHOME: undefined,
      PYTHONPATH: undefined,
      VIRTUAL_ENV: undefined,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONNOUSERSITE: '1',
      ...(options.env === undefined
        ? {}
        : {
          VISION_API_KEY: options.env.VISION_API_KEY,
          VISION_BASE_URL: options.env.VISION_BASE_URL,
          VISION_MODEL: options.env.VISION_MODEL,
          LANG: options.env.LANG,
          VISION_ENV_FILE: join(prepared.cleanHome, 'vision.env'),
        }),
    }
    let handle: SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn({
        argv: [prepared.python.program, ...prepared.python.prefix, script, ...args],
        cwd: prepared.cleanHome,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 512 * 1024, spill: { maxBytes: 8 * 1024 * 1024 } },
          stderr: { maxBytes: 256 * 1024, spill: { maxBytes: 8 * 1024 * 1024 } },
        },
        graceMs: 2000,
        signal: options.signal,
        env,
      })
    } catch (error) {
      throw new VisionToolkitError('runtime', `${tool}: failed to start ${displayCommand(prepared.python)}`, { cause: error })
    }
    try {
      return await this.collect(handle)
    } catch (error) {
      throw new VisionToolkitError('runtime', `${tool}: upstream process failed to start`, { cause: error })
    }
  }

  /** Read image dimensions through the prepared Pillow dependency. */
  async probeImageSize(
    imagePath: string,
    options: { signal: AbortSignal },
  ): Promise<{ width: number; height: number; format: string }> {
    if (this.prepared === undefined) await this.prepare()
    const prepared = this.requirePrepared()
    const script = [
      'import json,sys',
      'from PIL import Image',
      'with Image.open(sys.argv[1]) as im: print(json.dumps({"width":im.width,"height":im.height,"format":str(im.format or "unknown").lower()}))',
    ].join('\n')
    let handle: SubprocessHandle
    try {
      handle = this.ctx.subprocess.spawn({
        argv: [prepared.python.program, ...prepared.python.prefix, '-c', script, imagePath],
        cwd: prepared.cleanHome,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 4096 },
          stderr: { maxBytes: 4096 },
        },
        graceMs: 2000,
        signal: options.signal,
        env: {
          HOME: prepared.cleanHome,
          USERPROFILE: prepared.cleanHome,
          LOCALAPPDATA: prepared.cleanHome,
          PYTHONHOME: undefined,
          PYTHONPATH: undefined,
          VIRTUAL_ENV: undefined,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONNOUSERSITE: '1',
        },
      })
    } catch (error) {
      throw new VisionToolkitError('runtime', `cannot start ${displayCommand(prepared.python)} to inspect the image`, { cause: error })
    }
    const outcome = await this.collect(handle)
    if (outcome.outcome.exitCode !== 0) {
      throw new VisionToolkitError('input', `cannot decode image: ${outcome.stderr.trim() || 'unsupported or corrupt file'}`)
    }
    try {
      const parsed = JSON.parse(outcome.stdout) as { width?: unknown; height?: unknown; format?: unknown }
      if (
        typeof parsed.width !== 'number'
        || typeof parsed.height !== 'number'
        || typeof parsed.format !== 'string'
        || !Number.isInteger(parsed.width)
        || !Number.isInteger(parsed.height)
        || parsed.width <= 0
        || parsed.height <= 0
      ) throw new Error('invalid dimensions')
      return { width: parsed.width, height: parsed.height, format: parsed.format }
    } catch (error) {
      throw new VisionToolkitError('output', 'cannot read image dimensions: unexpected Python output', { cause: error })
    }
  }

  private async collect(handle: SubprocessHandle): Promise<UpstreamRunResult> {
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    return {
      stdout: stdout?.text ?? '',
      stderr: stderr?.text ?? '',
      stdoutTruncated: stdout?.lossy ?? false,
      stderrTruncated: stderr?.lossy ?? false,
      outcome,
    }
  }

  /** Report the pinned snapshot identity. */
  readCheckoutVersion(): Promise<string> {
    return Promise.resolve(UPSTREAM_VERSION)
  }

  /** Whether the prepared snapshot carries one optional script path. */
  async hasScript(name: string): Promise<boolean> {
    if (this.prepared === undefined) await this.prepare()
    try {
      const info = await stat(join(this.requirePrepared().root, 'skills', 'vision-tools', 'scripts', name))
      return info.isFile()
    } catch {
      return false
    }
  }

  /** Read one prepared upstream text file for diagnostics or compatibility tests. */
  async readText(relativePath: readonly string[]): Promise<string> {
    if (this.prepared === undefined) await this.prepare()
    return readFile(join(this.requirePrepared().root, ...relativePath), 'utf8')
  }

  /** Turn a failed run into a model-safe classified error. */
  classifyFailure(
    tool: UpstreamTool,
    result: UpstreamRunResult,
    options: { timedOut: boolean; cancelled: boolean; secrets?: readonly string[] },
  ): VisionToolkitError {
    if (options.cancelled) return new VisionToolkitError('cancelled', `${tool}: cancelled`)
    if (options.timedOut) return new VisionToolkitError('timeout', `${tool}: timed out`)
    if (result.stdoutTruncated || result.stderrTruncated) {
      return new VisionToolkitError('output', `${tool}: upstream output exceeded the capture limit`)
    }
    const message = upstreamFailureMessage(tool, result.stderr, options.secrets ?? [])
    if (/HTTP 401|\b401\b|Unauthorized|authentication/i.test(result.stderr)) {
      return new VisionToolkitError('service', `${message}; verify the configured credential`)
    }
    if (/HTTP 429|\b429\b|rate limit|quota/i.test(result.stderr)) {
      return new VisionToolkitError('service', `${message}; retry later or reduce concurrency`)
    }
    if (/Missing config VISION_/i.test(result.stderr)) {
      return new VisionToolkitError('config', message)
    }
    if (/not found|only PNG|unsupported|cannot open|empty region/i.test(result.stderr)) {
      return new VisionToolkitError('input', message)
    }
    if (/requires Pillow|requires numpy|requires vtracer|no Chrome/i.test(result.stderr)) {
      return new VisionToolkitError('runtime', message)
    }
    return new VisionToolkitError('service', message)
  }
}
