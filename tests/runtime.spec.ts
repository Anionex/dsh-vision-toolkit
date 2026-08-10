import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
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
