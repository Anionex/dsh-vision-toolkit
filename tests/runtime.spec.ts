import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import { resolveConfig, type VisionToolkitConfig } from '../src/config.ts'
import { VisionToolkitError } from '../src/errors.ts'
import { createDeadline, Semaphore, VisionToolkitRuntime } from '../src/runtime.ts'
import {
  UpstreamAdapter,
  type UpstreamEnvironment,
  type UpstreamRunResult,
  type UpstreamTool,
} from '../src/upstream.ts'
import type { PreparedUpstreamRuntime } from '../src/runtime-install.ts'
import { UPSTREAM_VERSION } from '../src/version.ts'

const FIXTURE_UPSTREAM = fileURLToPath(new URL('./fixtures/upstream', import.meta.url))
const SAMPLE_IMAGE = fileURLToPath(new URL('./fixtures/sample.png', import.meta.url))

const tempDirs: string[] = []
const contexts: Context[] = []

async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-vision-toolkit-runtime-'))
  tempDirs.push(dir)
  await copyFile(SAMPLE_IMAGE, join(dir, 'sample.png'))
  return dir
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function preparedFixture(): PreparedUpstreamRuntime {
  return {
    source: 'external',
    root: FIXTURE_UPSTREAM,
    python: { program: 'python3', prefix: [], display: 'python3' },
    cleanHome: FIXTURE_UPSTREAM,
    pythonVersion: '3.11+',
    dependencies: { pillow: 'fixture', numpy: 'fixture', vtracer: 'fixture' },
  }
}

async function setup(
  overrides: VisionToolkitConfig = {},
  credential: string | null = 'test-vision-key',
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSubprocessService)
  ctx.provide('credentials', {
    async resolve() {
      return credential === null ? undefined : { value: credential, source: 'env' }
    },
  } as unknown as Credentials)
  const config = resolveConfig({
    provider: {
      baseUrl: 'https://vision.example/v1',
      credential: 'VISION_API_KEY',
      model: 'fixture-model',
    },
    runtime: { mode: 'external', agentVisionToolkitPath: FIXTURE_UPSTREAM, python: 'python3' },
    ...overrides,
  })
  const adapter = new UpstreamAdapter(ctx, config, preparedFixture())
  const runtime = new VisionToolkitRuntime(ctx, config, adapter)
  return { ctx, config, adapter, runtime }
}

function mockTraceDocument(
  adapter: UpstreamAdapter,
  svg: string,
  reportedPathCount = 1,
  reportedBytes = Buffer.byteLength(svg),
): void {
  vi.spyOn(adapter, 'run').mockImplementationOnce(async (_tool, args) => {
    const outputIndex = args.indexOf('-o')
    const outputPath = outputIndex === -1 ? undefined : args[outputIndex + 1]
    if (outputPath === undefined) throw new Error('trace output path was not provided')
    await writeFile(outputPath, svg)
    return {
      stdout: `wrote ${outputPath} (${reportedBytes} bytes, ${reportedPathCount} paths, traced at 1x)\n`,
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      outcome: { exitCode: 0, signal: null },
    }
  })
}

const signal = new AbortController().signal

describe('VisionToolkitRuntime', () => {
  it('glance describes an image', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.glance({ images: ['sample.png'] }, { signal, workspace })
    expect(result).toMatchObject({ mode: 'describe', answer: 'Fixture detailed description', truncated: false })
    expect(result.images[0]).toMatchObject({ width: 256, height: 256, format: 'png' })
    expect(result.images[0]?.bytes).toBeGreaterThan(0)
  })

  it('glance answers a question, OCRs, and zooms into a region', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const qa = await runtime.glance({ images: ['sample.png'], query: 'what color?' }, { signal, workspace })
    expect(qa).toMatchObject({ mode: 'qa', answer: 'Fixture answer to the question' })
    const ocr = await runtime.glance({ images: ['sample.png'], ocr: true }, { signal, workspace })
    expect(ocr).toMatchObject({ mode: 'ocr', answer: 'Fixture OCR text' })
    const region = await runtime.glance({ images: ['sample.png'], region: '10,10,30,30', query: 'x' }, { signal, workspace })
    expect(region.answer).toBe('Fixture answer to the question')
  })

  it('deduplicates the same resolved image inside one glance request', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.glance({ images: ['sample.png', './sample.png'] }, { signal, workspace })
    expect(result.images).toHaveLength(1)
    expect(result.answer).toBe('Fixture detailed description')
  })

  it('reuses the last identical glance result only inside the same live session', async () => {
    const { adapter, runtime } = await setup()
    const workspace = await tempWorkspace()
    const run = vi.spyOn(adapter, 'run')
    const firstSession = {}
    const options = { signal, workspace, sessionId: 'first', sessionScope: firstSession }

    const first = await runtime.glance({ images: ['sample.png'], query: 'what color?' }, options)
    const second = await runtime.glance({ images: ['./sample.png'], query: 'what color?' }, options)
    expect(second).toEqual(first)
    expect(run).toHaveBeenCalledTimes(1)

    await runtime.glance({ images: ['sample.png'], query: 'what shape?' }, options)
    expect(run).toHaveBeenCalledTimes(2)

    await runtime.glance(
      { images: ['sample.png'], query: 'what shape?' },
      { signal, workspace, sessionId: 'second', sessionScope: {} },
    )
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('does not cache a failed glance request', async () => {
    const { adapter, runtime } = await setup()
    const workspace = await tempWorkspace()
    const originalRun = adapter.run.bind(adapter)
    const run = vi.spyOn(adapter, 'run')
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'HTTP 429 fixture limit',
        stdoutTruncated: false,
        stderrTruncated: false,
        outcome: { exitCode: 1, signal: null },
      })
      .mockImplementation(originalRun)
    const options = { signal, workspace, sessionId: 'retry', sessionScope: {} }

    await expect(runtime.glance({ images: ['sample.png'] }, options)).rejects.toMatchObject({ code: 'service' })
    await expect(runtime.glance({ images: ['sample.png'] }, options)).resolves.toMatchObject({ answer: 'Fixture detailed description' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('rejects truncated upstream output instead of exposing a partial model result', async () => {
    const { adapter, runtime } = await setup()
    const workspace = await tempWorkspace()
    vi.spyOn(adapter, 'run').mockResolvedValueOnce({
      stdout: 'partial response',
      stderr: '',
      stdoutTruncated: true,
      stderrTruncated: false,
      outcome: { exitCode: 0, signal: null },
    })

    await expect(runtime.glance({ images: ['sample.png'] }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'output' })
  })

  it('glance rejects region with multiple images and mutually exclusive modes', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    await expect(runtime.glance({ images: ['sample.png', 'sample.png'], region: '0,0,1,1' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
    await expect(runtime.glance({ images: ['sample.png'], query: 'x', ocr: true }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
  })

  it('ground returns normalized in-range pixel boxes with image size', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.ground({ image: 'sample.png', target: 'send button' }, { signal, workspace })
    expect(result).toEqual({
      target: 'send button',
      image: {
        path: expect.stringMatching(/sample\.png$/),
        bytes: expect.any(Number),
        width: 256,
        height: 256,
        format: 'png',
      },
      imageWidth: 256,
      imageHeight: 256,
      matches: [{ label: 'send button', box: { x1: 100, y1: 50, x2: 200, y2: 90 } }],
    })
  })

  it('detect returns a numbered element inventory', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.detect({ image: 'sample.png', target: 'buttons' }, { signal, workspace })
    expect(result.category).toBe('buttons')
    expect(result.elements).toEqual([
      { index: 1, label: 'button', box: { x1: 10, y1: 20, x2: 60, y2: 40 } },
      { index: 2, label: 'input', box: { x1: 130, y1: 100, x2: 220, y2: 140 } },
    ])
  })

  it('rejects unknown and out-of-range location output', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    await expect(runtime.ground({ image: 'sample.png', target: 'unknown-output' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'output' })
    await expect(runtime.ground({ image: 'sample.png', target: 'out-of-range' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'output' })
  })

  it('crop writes an image file and reports dimensions without a credential', async () => {
    const { runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    const result = await runtime.crop({ image: 'sample.png', region: '10,20,50,40' }, { signal, workspace })
    expect(result.outputPath).toContain(join('.dsh-vision-toolkit', 'artifacts'))
    expect(result).toMatchObject({ mimeType: 'image/png', width: 40, height: 20, clamped: false })
  })

  it('trace writes an SVG and returns pinned vtracer facts without a credential', async () => {
    const { runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    const result = await runtime.trace({ image: 'sample.png', scale: 2 }, { signal, workspace })
    expect(result.outputPath).toContain(join('.dsh-vision-toolkit', 'artifacts'))
    expect(result).toMatchObject({
      mimeType: 'image/svg+xml',
      imageWidth: 256,
      imageHeight: 256,
      geometry: { status: 'generated', pathCount: 1, tracedScale: 2 },
    })
    expect(result.geometry.bytes).toBeGreaterThan(0)
  })

  it('accepts declarations, comments, and namespace-prefixed SVG elements', async () => {
    const { adapter, runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    const svg = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- literal text such as <!DOCTYPE svg> is not a document type -->',
      '<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:g><s:path d="M0 0"/></s:g></s:svg>',
      '',
    ].join('\n')
    mockTraceDocument(adapter, svg)

    const result = await runtime.trace({ image: 'sample.png' }, { signal, workspace })

    expect(result.geometry).toMatchObject({ status: 'generated', pathCount: 1 })
    await expect(readFile(result.outputPath, 'utf8')).resolves.toBe(svg)
  })

  it('rejects a trace character count when the generated SVG contains expanded CRLF bytes', async () => {
    const { adapter, runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg">\r\n<path/>\r\n</svg>\r\n'
    mockTraceDocument(adapter, svg, 1, Buffer.byteLength(svg) - 3)

    await expect(runtime.trace({ image: 'sample.png' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'output', message: 'trace: reported byte count does not match the generated SVG' })
  })

  it.each([
    ['a doctype', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"><path/></svg>\n'],
    ['malformed nesting', '<svg xmlns="http://www.w3.org/2000/svg"><path></svg>\n'],
    ['multiple roots', '<svg xmlns="http://www.w3.org/2000/svg"/><svg xmlns="http://www.w3.org/2000/svg"/>\n'],
    ['a non-SVG root', '<html xmlns="http://www.w3.org/2000/svg"><path/></html>\n'],
    ['the wrong namespace', '<svg xmlns="urn:not-svg"><path/></svg>\n'],
    ['trailing document text', '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>not-xml\n'],
  ] as const)('rejects trace SVG documents with %s before artifact commit', async (_label, svg) => {
    const { adapter, runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    mockTraceDocument(adapter, svg)

    await expect(runtime.trace({ image: 'sample.png' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'output', message: 'trace: output SVG is not a parseable document' })
    await expect(readFile(join(workspace, '.dsh-vision-toolkit', 'artifacts', 'sample.svg'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['path count', 2, undefined, 'trace: reported path count does not match the generated SVG'],
    ['byte count', 1, 1, 'trace: reported byte count does not match the generated SVG'],
  ] as const)('rejects a mismatched trace %s before artifact commit', async (_label, pathCount, bytes, message) => {
    const { adapter, runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>\n'
    mockTraceDocument(adapter, svg, pathCount, bytes)

    await expect(runtime.trace({ image: 'sample.png' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'output', message })
    await expect(readFile(join(workspace, '.dsh-vision-toolkit', 'artifacts', 'sample.svg'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enforces byte and decoded-pixel limits as capacity errors', async () => {
    const workspace = await tempWorkspace()
    const byteLimited = await setup({ maxImageBytes: 1024 })
    await expect(byteLimited.runtime.glance({ images: ['sample.png'] }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'capacity' })
    const pixelLimited = await setup({ maxImagePixels: 65_535 })
    await expect(pixelLimited.runtime.glance({ images: ['sample.png'] }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'capacity' })
  })

  it('rejects missing images, malformed regions, and extension/content mismatches', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    await copyFile(SAMPLE_IMAGE, join(workspace, 'disguised.jpg'))
    await expect(runtime.ground({ image: 'missing.png', target: 'x' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
    await expect(runtime.crop({ image: 'sample.png', region: '1,2,3' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
    await expect(runtime.glance({ images: ['disguised.jpg'] }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
  })

  it('distinguishes caller cancellation from a hard operation timeout', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const aborted = new AbortController()
    aborted.abort()
    await expect(runtime.glance({ images: ['sample.png'] }, { signal: aborted.signal, workspace }))
      .rejects.toMatchObject({ code: 'cancelled' })
    await expect(runtime.glance(
      { images: ['sample.png'], query: '__sleep__' },
      { signal, workspace, timeoutMs: 1000 },
    )).rejects.toMatchObject({ code: 'timeout' })
  })

  it('requires a credential only for remote vision operations', async () => {
    const { runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    await expect(runtime.glance({ images: ['sample.png'] }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'config' })
    await expect(runtime.crop({ image: 'sample.png', region: '0,0,10,10' }, { signal, workspace }))
      .resolves.toMatchObject({ width: 40, height: 20 })
  })

  it('delivers labeled ground previews as managed image artifacts', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.ground(
      { image: 'sample.png', target: 'send button', preview: true },
      { signal, workspace },
    )
    expect(result.preview).toMatchObject({
      mimeType: 'image/png',
      kind: 'image',
      sourceTool: 'vision_ground',
      previewIntent: 'image',
    })
    expect(result.preview?.path).toContain(join('.dsh-vision-toolkit', 'artifacts'))
    expect(result.preview?.bytes).toBeGreaterThan(0)
  })

  it('pixel-diffs two images and atomically delivers heatmap and report artifacts', async () => {
    const { runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    await copyFile(SAMPLE_IMAGE, join(workspace, 'rebuilt.png'))
    const result = await runtime.pixelDiff(
      { original: 'sample.png', rebuilt: 'rebuilt.png', grid: 4, top: 1 },
      { signal, workspace },
    )
    expect(result).toMatchObject({
      scaled: false,
      overallDifferencePct: 12.34,
      worstRegions: [{ index: 1, differencePct: 23.45 }],
      heatmap: { kind: 'image', mimeType: 'image/png', sourceTool: 'vision_pixel_diff' },
      report: { kind: 'json', mimeType: 'application/json', sourceTool: 'vision_pixel_diff' },
    })
    const report = JSON.parse(await readFile(result.report.path, 'utf8')) as { schemaVersion: number; grid: number }
    expect(report).toMatchObject({ schemaVersion: 1, grid: 4 })
  })

  it('splits long screenshots without credentials and OCRs/resumes with credentials', async () => {
    const noCredential = await setup({}, null)
    const workspace = await tempWorkspace()
    const split = await noCredential.runtime.longScreenshotOcr(
      { image: 'sample.png', splitOnly: true, runName: 'sample-split' },
      { signal, workspace },
    )
    expect(split).toMatchObject({ splitOnly: true, complete: false, chunkCount: 1 })
    expect(split.output).toBeUndefined()
    expect(split.audit).toBeUndefined()
    expect(split.manifest.kind).toBe('json')
    expect(split.chunks[0]?.image.kind).toBe('image')

    const withCredential = await setup()
    const first = await withCredential.runtime.longScreenshotOcr(
      { image: 'sample.png', runName: 'sample-ocr', jobs: 1 },
      { signal, workspace },
    )
    expect(first).toMatchObject({ splitOnly: false, complete: true, chunkCount: 1 })
    expect(first.output?.kind).toBe('markdown')
    expect(first.audit?.kind).toBe('markdown')
    expect(first.chunks[0]?.ocr?.kind).toBe('markdown')
    const resumed = await withCredential.runtime.longScreenshotOcr(
      { image: 'sample.png', runName: 'sample-ocr', jobs: 1, resume: true },
      { signal, workspace },
    )
    expect(resumed.runDirectory).toBe(first.runDirectory)
    expect(await readFile(resumed.output?.path ?? '', 'utf8')).toContain('Fixture merged OCR')
  })

  it('extracts transparent foregrounds from UTF-8 Chinese subprocess output', async () => {
    vi.stubEnv('PYTHONIOENCODING', 'cp936')
    vi.stubEnv('PYTHONUTF8', '0')
    const { ctx, runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    const result = await runtime.extractForeground(
      { image: 'sample.png', region: '0,0,128,128' },
      { signal, workspace },
    )
    expect(result).toMatchObject({
      box: { x1: 10, y1: 20, x2: 42, y2: 44 },
      foregroundPixels: 512,
      keptComponents: 1,
      totalComponents: 2,
      largestComponentPct: 88,
      artifact: { mimeType: 'image/png', kind: 'image', sourceTool: 'vision_extract_foreground' },
    })
    const extractSpawn = spawn.mock.calls.find(([spec]) => spec.argv.some(arg => arg.endsWith('extract_fg.py')))
    expect(extractSpawn?.[0].env).toMatchObject({ PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
  })

  it('parses palette extraction and candidate scoring into structure', async () => {
    const { runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    const palette = await runtime.dominantColors({ image: 'sample.png' }, { signal, workspace })
    expect(palette.analysis.mode).toBe('palette')
    if (palette.analysis.mode !== 'palette') throw new Error('expected palette mode')
    expect(palette.analysis.colors).toEqual(expect.arrayContaining([{ color: '#336699', sharePct: 42.1 }]))
    const candidates = await runtime.dominantColors(
      { image: 'sample.png', candidates: ['#336699', '#FFFFFF'] },
      { signal, workspace },
    )
    expect(candidates.analysis).toMatchObject({
      mode: 'candidates',
      winner: '#336699',
      matchedWithinTolerance: true,
    })
  })

  it('renders only authorized local HTML and delivers a PNG artifact', async () => {
    const { runtime } = await setup({}, null)
    const workspace = await tempWorkspace()
    await writeFile(join(workspace, 'page.html'), '<!doctype html><title>fixture</title>\n')
    const result = await runtime.htmlScreenshot(
      { source: 'page.html', width: 320, height: 180, scale: 2 },
      { signal, workspace },
    )
    expect(result).toMatchObject({
      viewport: { width: 320, height: 180, scale: 2 },
      width: 640,
      height: 360,
      artifact: { mimeType: 'image/png', kind: 'image', sourceTool: 'vision_html_screenshot' },
    })
    await expect(runtime.htmlScreenshot({ source: 'https://example.com' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
  })

  it('reports health without network access and tests /models only when explicit', async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe('/v1/models')
      expect(request.headers.authorization).toBe('Bearer test-vision-key')
      expect(request.headers['user-agent']).toContain('Mozilla/5.0')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"data":[]}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('missing fixture server address')
      const { runtime } = await setup({
        provider: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          credential: 'VISION_API_KEY',
          model: 'fixture-model',
        },
      })
      const workspace = await tempWorkspace()
      const passive = await runtime.health(false, { signal, workspace })
      expect(passive).toMatchObject({
        connectionTested: false,
        checks: { chrome: { status: 'ok' }, credential: { status: 'ok' }, service: { status: 'not_tested' } },
      })
      const active = await runtime.health(true, { signal, workspace })
      expect(active).toMatchObject({ connectionTested: true, checks: { service: { status: 'ok' } } })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    }
  })

  it('uses Anthropic authentication for an explicit connection test', async () => {
    const server = createServer((request, response) => {
      expect(request.url).toBe('/v1/models')
      expect(request.headers.authorization).toBeUndefined()
      expect(request.headers['x-api-key']).toBe('test-vision-key')
      expect(request.headers['anthropic-version']).toBe('2023-06-01')
      expect(request.headers['user-agent']).toBe('fixture-agent/1.0')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"data":[]}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('fixture server did not bind')
      const { runtime } = await setup({
        provider: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          credential: 'VISION_API_KEY',
          model: 'fixture-model',
          protocol: 'anthropic',
          userAgent: 'fixture-agent/1.0',
        },
      })
      const workspace = await tempWorkspace()
      await expect(runtime.health(true, { signal, workspace }))
        .resolves.toMatchObject({ connectionTested: true, checks: { service: { status: 'ok' } } })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    }
  })
})

describe('createDeadline', () => {
  it('reports only timeout when the timer fires first', async () => {
    const controller = new AbortController()
    const deadline = createDeadline(controller.signal, 20)
    await new Promise(resolve => setTimeout(resolve, 40))
    controller.abort()
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.timedOut).toBe(true)
    expect(deadline.cancelled).toBe(false)
    deadline.cleanup()
  })

  it('reports only cancellation when the caller signal fires first', async () => {
    const controller = new AbortController()
    const deadline = createDeadline(controller.signal, 20)
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.timedOut).toBe(false)
    expect(deadline.cancelled).toBe(true)
    deadline.cleanup()
  })
})

describe('Semaphore', () => {
  it('bounds concurrent acquisitions and transfers a slot without losing capacity', async () => {
    const semaphore = new Semaphore(1)
    await semaphore.acquire(new AbortController().signal)
    const second = semaphore.acquire(new AbortController().signal)
    let secondDone = false
    void second.then(() => { secondDone = true })
    await Promise.resolve()
    expect(secondDone).toBe(false)
    semaphore.release()
    await second
    expect(secondDone).toBe(true)
    expect(semaphore.idle).toBe(false)
    semaphore.release()
    expect(semaphore.idle).toBe(true)
  })

  it('rejects a queued waiter when its signal aborts', async () => {
    const semaphore = new Semaphore(1)
    await semaphore.acquire(new AbortController().signal)
    const controller = new AbortController()
    const waiting = semaphore.acquire(controller.signal)
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'cancelled' })
    semaphore.release()
  })

  it('accounts for weighted callers without exceeding total capacity', async () => {
    const semaphore = new Semaphore(3)
    await semaphore.acquire(new AbortController().signal, 2)
    const second = semaphore.acquire(new AbortController().signal, 2)
    let settled = false
    void second.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    semaphore.release(2)
    await second
    expect(settled).toBe(true)
    semaphore.release(2)
    expect(semaphore.idle).toBe(true)
  })
})

class TrackingAdapter extends UpstreamAdapter {
  active = 0
  maxActive = 0

  override probeImageSize(): Promise<{ width: number; height: number; format: string }> {
    return Promise.resolve({ width: 256, height: 256, format: 'png' })
  }

  override async run(
    _tool: UpstreamTool,
    _args: readonly string[],
    _options: { signal: AbortSignal; env?: UpstreamEnvironment },
  ): Promise<UpstreamRunResult> {
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    try {
      await new Promise(resolve => setTimeout(resolve, 40))
      return {
        stdout: 'tracked\n',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        outcome: { exitCode: 0, signal: null },
      }
    } finally {
      this.active -= 1
    }
  }
}

describe('session-scoped concurrency', () => {
  it('serializes one session while allowing independent sessions to overlap', async () => {
    const { ctx, config } = await setup({ concurrency: 1 })
    const adapter = new TrackingAdapter(ctx, config, preparedFixture())
    const runtime = new VisionToolkitRuntime(ctx, config, adapter)
    const workspace = await tempWorkspace()

    await Promise.all([
      runtime.glance({ images: ['sample.png'] }, { signal, workspace, sessionId: 'same' }),
      runtime.glance({ images: ['sample.png'] }, { signal, workspace, sessionId: 'same' }),
    ])
    expect(adapter.maxActive).toBe(1)

    adapter.maxActive = 0
    await Promise.all([
      runtime.glance({ images: ['sample.png'] }, { signal, workspace, sessionId: 'one' }),
      runtime.glance({ images: ['sample.png'] }, { signal, workspace, sessionId: 'two' }),
    ])
    expect(adapter.maxActive).toBe(2)
  })
})

describe('upstream adapter version facts', () => {
  it('reports the prepared pinned snapshot identity', async () => {
    const { adapter } = await setup()
    expect(adapter.versionInfo).toMatchObject({
      path: FIXTURE_UPSTREAM,
      source: 'external',
      python: 'python3',
      dependencies: { pillow: 'fixture' },
    })
    expect(await adapter.readCheckoutVersion()).toBe(UPSTREAM_VERSION)
  })

  it('forces UTF-8 for direct tools, image probes, and Python helpers', async () => {
    const { ctx, adapter } = await setup({}, null)
    const workspace = await tempWorkspace()
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')

    await adapter.run('crop', [SAMPLE_IMAGE, '--region', '0,0,2,2', '-o', join(workspace, 'crop.png')], { signal })
    await adapter.probeImageSize(SAMPLE_IMAGE, { signal })
    await adapter.renderAnnotatedPreview(SAMPLE_IMAGE, join(workspace, 'preview.png'), [], { signal })

    expect(spawn).toHaveBeenCalledTimes(3)
    for (const [spec] of spawn.mock.calls) {
      expect(spec.env).toMatchObject({ PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
    }
  })

  it('forwards the resolved Anthropic protocol to remote upstream tools', async () => {
    const { ctx, adapter, runtime } = await setup({
      provider: {
        baseUrl: 'https://vision.example/v1',
        credential: 'VISION_API_KEY',
        model: 'fixture-model',
        protocol: 'anthropic',
      },
    })
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')

    await adapter.run('glance', [SAMPLE_IMAGE], { signal, env: await runtime.resolveVisionEnv() })

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn.mock.calls[0]?.[0].env).toMatchObject({
      VISION_API_PROTOCOL: 'anthropic',
      VISION_ANTHROPIC_THINKING: 'omit',
      VISION_API_KEY: 'test-vision-key',
      VISION_USER_AGENT: expect.stringContaining('Mozilla/5.0'),
    })
  })

  it('fails prepare with a clear runtime error when the external path is missing', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessService)
    const config = resolveConfig({
      provider: { baseUrl: 'https://vision.example/v1', credential: 'K', model: 'm' },
      runtime: { mode: 'external', agentVisionToolkitPath: '/nonexistent/toolkit' },
    })
    const adapter = new UpstreamAdapter(ctx, config)
    await expect(adapter.prepare()).rejects.toBeInstanceOf(VisionToolkitError)
  })
})
