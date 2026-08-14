/**
 * Reproduce the packaged UI-restoration example through the real local
 * Vision Toolkit runtime: HTML screenshots first, then pixel comparisons.
 * @module dsh-vision-toolkit/scripts/ui-restoration-example
 */

import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import { resolveConfig } from '../src/config.ts'
import type { PreparedUpstreamRuntime, RuntimeCommand } from '../src/runtime-install.ts'
import { bundledUpstreamRoot } from '../src/runtime-install.ts'
import { VisionToolkitRuntime } from '../src/runtime.ts'
import { UpstreamAdapter } from '../src/upstream.ts'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXAMPLE_ROOT = join(PLUGIN_ROOT, 'examples', 'ui-restoration')
const ASSET_ROOT = join(EXAMPLE_ROOT, 'assets')
const REFERENCE_SOURCE = join(PLUGIN_ROOT, 'tests', 'fixtures', 'ui-restoration-reference.html')
const INITIAL_SOURCE = join(EXAMPLE_ROOT, 'initial.html')
const IMPLEMENTATION_SOURCE = join(EXAMPLE_ROOT, 'implementation.html')
const VIEWPORT = { width: 1200, height: 720, scale: 1 } as const
const RUN_TIMEOUT_MS = 120_000
const MAX_FINAL_DIFFERENCE_PCT = 0.02
const MIN_INITIAL_DIFFERENCE_PCT = 1

interface PythonProbe {
  command: RuntimeCommand
  version: string
  dependencies: Record<string, string>
}

interface ExampleMetrics {
  schemaVersion: 1
  viewport: typeof VIEWPORT
  initialDifferencePct: number
  finalDifferencePct: number
  initialWorstRegions: number
  finalWorstRegions: number
}

/** Structured acceptance result printed by the reusable example runner. */
export interface UiRestorationExampleResult extends ExampleMetrics {
  mode: 'check' | 'write'
  assetDirectory: string
  runtime: {
    python: string
    pythonVersion: string
    dependencies: Record<string, string>
  }
}

function parseMode(args: readonly string[]): 'check' | 'write' {
  if (args.length !== 1 || (args[0] !== '--check' && args[0] !== '--write')) {
    throw new Error('usage: npm run example:ui-restoration [-- --check|--write]')
  }
  return args[0] === '--write' ? 'write' : 'check'
}

function probePython(): PythonProbe {
  const candidates: RuntimeCommand[] = process.platform === 'win32'
    ? [
      { program: 'py', prefix: ['-3'], display: 'py -3' },
      { program: 'python', prefix: [], display: 'python' },
      { program: 'python3', prefix: [], display: 'python3' },
    ]
    : [
      { program: 'python3', prefix: [], display: 'python3' },
      { program: 'python', prefix: [], display: 'python' },
    ]
  const code = [
    'import json,platform',
    'import PIL,numpy',
    'print(json.dumps({"version":platform.python_version(),"pillow":PIL.__version__,"numpy":numpy.__version__}))',
  ].join(';')
  for (const command of candidates) {
    const result = spawnSync(command.program, [...command.prefix, '-c', code], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    })
    if (result.status !== 0) continue
    try {
      const parsed = JSON.parse(result.stdout.trim()) as { version?: unknown; pillow?: unknown; numpy?: unknown }
      if (typeof parsed.version !== 'string' || typeof parsed.pillow !== 'string' || typeof parsed.numpy !== 'string') continue
      return {
        command,
        version: parsed.version,
        dependencies: { pillow: parsed.pillow, numpy: parsed.numpy, vtracer: 'not-used-by-this-example' },
      }
    } catch {
      // A candidate that does not return the exact probe contract is ignored.
    }
  }
  throw new Error('UI restoration example requires Python with Pillow and NumPy')
}

async function assertSource(path: string): Promise<void> {
  const info = await stat(path)
  if (!info.isFile() || info.size === 0) throw new Error(`example source is missing or empty: ${path}`)
}

async function copyArtifact(source: string, filename: string): Promise<void> {
  await mkdir(ASSET_ROOT, { recursive: true })
  await copyFile(source, join(ASSET_ROOT, filename))
}

async function writePortableReport(
  source: string,
  filename: string,
  original: string,
  rebuilt: string,
): Promise<void> {
  await mkdir(ASSET_ROOT, { recursive: true })
  const parsed = JSON.parse(await readFile(source, 'utf8')) as {
    original?: { path?: unknown }
    rebuilt?: { path?: unknown }
  }
  if (typeof parsed.original?.path !== 'string' || typeof parsed.rebuilt?.path !== 'string') {
    throw new Error(`pixel-diff report has an invalid path contract: ${source}`)
  }
  parsed.original.path = `assets/${original}`
  parsed.rebuilt.path = `assets/${rebuilt}`
  await writeFile(join(ASSET_ROOT, filename), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
}

async function ensureCheckedAssets(): Promise<void> {
  const expected = [
    'reference.png',
    'initial.png',
    'initial-heatmap.png',
    'implementation.png',
    'final-heatmap.png',
    'initial-report.json',
    'final-report.json',
    'metrics.json',
  ]
  for (const filename of expected) {
    const info = await stat(join(ASSET_ROOT, filename))
    if (!info.isFile() || info.size === 0) throw new Error(`checked-in example asset is missing or empty: ${filename}`)
  }
  const checked = JSON.parse(await readFile(join(ASSET_ROOT, 'metrics.json'), 'utf8')) as Partial<ExampleMetrics>
  const viewport = checked.viewport
  if (
    checked.schemaVersion !== 1
    || viewport?.width !== VIEWPORT.width
    || viewport.height !== VIEWPORT.height
    || viewport.scale !== VIEWPORT.scale
    || typeof checked.initialDifferencePct !== 'number'
    || typeof checked.finalDifferencePct !== 'number'
    || checked.initialDifferencePct < MIN_INITIAL_DIFFERENCE_PCT
    || checked.finalDifferencePct > MAX_FINAL_DIFFERENCE_PCT
  ) throw new Error('checked-in UI restoration metrics have an invalid contract')
}

/**
 * Render and compare the complete reference → implementation → screenshot →
 * pixel-diff loop, optionally refreshing the checked-in evidence.
 * @param mode - `check` validates current evidence; `write` replaces it.
 * @returns structured metrics and the runtime used for the run.
 */
export async function runUiRestorationExample(mode: 'check' | 'write'): Promise<UiRestorationExampleResult> {
  await Promise.all([REFERENCE_SOURCE, INITIAL_SOURCE, IMPLEMENTATION_SOURCE].map(assertSource))
  const python = probePython()
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-vision-ui-restoration-'))
  const cleanHome = join(workspace, 'runtime-home')
  const ctx = new Context()

  try {
    await mkdir(cleanHome, { recursive: true })
    await ctx.plugin(LocalSubprocessService)
    await Promise.all([
      copyFile(REFERENCE_SOURCE, join(workspace, 'reference.html')),
      copyFile(INITIAL_SOURCE, join(workspace, 'initial.html')),
      copyFile(IMPLEMENTATION_SOURCE, join(workspace, 'implementation.html')),
    ])
    const config = resolveConfig({
      timeoutMs: RUN_TIMEOUT_MS,
      maxImageBytes: 16 * 1024 * 1024,
      maxImagePixels: VIEWPORT.width * VIEWPORT.height * 4,
      runtime: { mode: 'managed' },
    })
    const prepared: PreparedUpstreamRuntime = {
      source: 'managed',
      root: bundledUpstreamRoot(),
      python: python.command,
      cleanHome,
      pythonVersion: python.version,
      dependencies: python.dependencies,
    }
    const runtime = new VisionToolkitRuntime(ctx, config, new UpstreamAdapter(ctx, config, prepared))
    const signal = AbortSignal.timeout(RUN_TIMEOUT_MS)
    const options = { signal, workspace, sessionId: 'ui-restoration-example' }
    const render = async (source: string, output: string) => runtime.htmlScreenshot({
      source,
      output,
      ...VIEWPORT,
    }, options)

    const reference = await render('reference.html', 'reference.png')
    const initial = await render('initial.html', 'initial.png')
    const implementation = await render('implementation.html', 'implementation.png')
    const initialDiff = await runtime.pixelDiff({
      original: reference.artifact.path,
      rebuilt: initial.artifact.path,
      grid: 8,
      top: 6,
      runName: 'initial-diff',
    }, options)
    const finalDiff = await runtime.pixelDiff({
      original: reference.artifact.path,
      rebuilt: implementation.artifact.path,
      grid: 8,
      top: 6,
      runName: 'final-diff',
    }, options)

    if (initialDiff.overallDifferencePct < MIN_INITIAL_DIFFERENCE_PCT) {
      throw new Error(`initial reconstruction is not meaningfully different: ${initialDiff.overallDifferencePct}%`)
    }
    if (finalDiff.overallDifferencePct > MAX_FINAL_DIFFERENCE_PCT) {
      throw new Error(`final reconstruction exceeds ${MAX_FINAL_DIFFERENCE_PCT}% difference: ${finalDiff.overallDifferencePct}%`)
    }

    const metrics: ExampleMetrics = {
      schemaVersion: 1,
      viewport: VIEWPORT,
      initialDifferencePct: initialDiff.overallDifferencePct,
      finalDifferencePct: finalDiff.overallDifferencePct,
      initialWorstRegions: initialDiff.worstRegions.filter(region => region.differencePct > 0).length,
      finalWorstRegions: finalDiff.worstRegions.filter(region => region.differencePct > 0).length,
    }
    if (mode === 'write') {
      await Promise.all([
        copyArtifact(reference.artifact.path, 'reference.png'),
        copyArtifact(initial.artifact.path, 'initial.png'),
        copyArtifact(initialDiff.heatmap.path, 'initial-heatmap.png'),
        copyArtifact(implementation.artifact.path, 'implementation.png'),
        copyArtifact(finalDiff.heatmap.path, 'final-heatmap.png'),
        writePortableReport(initialDiff.report.path, 'initial-report.json', 'reference.png', 'initial.png'),
        writePortableReport(finalDiff.report.path, 'final-report.json', 'reference.png', 'implementation.png'),
      ])
      await writeFile(join(ASSET_ROOT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8')
    } else {
      await ensureCheckedAssets()
    }
    return {
      ...metrics,
      mode,
      assetDirectory: ASSET_ROOT,
      runtime: {
        python: python.command.display,
        pythonVersion: python.version,
        dependencies: python.dependencies,
      },
    }
  } finally {
    await ctx.fiber.dispose()
    await rm(workspace, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const result = await runUiRestorationExample(parseMode(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${basename(process.argv[1] ?? 'ui-restoration-example')}: ${message}\n`)
    process.exitCode = 1
  })
}
