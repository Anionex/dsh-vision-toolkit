import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import { resolveConfig } from '../src/config.ts'
import { VisionToolkitError } from '../src/errors.ts'
import { createDeadline, Semaphore, VisionToolkitRuntime } from '../src/runtime.ts'
import { UpstreamAdapter } from '../src/upstream.ts'

const FIXTURE_UPSTREAM = fileURLToPath(new URL('./fixtures/upstream', import.meta.url))
const SAMPLE_IMAGE = fileURLToPath(new URL('./fixtures/sample.png', import.meta.url))

const tempDirs: string[] = []
async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-vision-toolkit-runtime-'))
  tempDirs.push(dir)
  await copyFile(SAMPLE_IMAGE, join(dir, 'sample.png'))
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function setup(overrides: Parameters<typeof resolveConfig>[0] = {}) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessService)
  ctx.provide('credentials', {
    async resolve() {
      return { value: 'test-vision-key', source: 'env' }
    },
  } as unknown as Credentials)
  const config = resolveConfig({
    provider: {
      baseUrl: 'https://vision.example/v1',
      credential: 'VISION_API_KEY',
      model: 'fixture-model',
    },
    runtime: { agentVisionToolkitPath: FIXTURE_UPSTREAM, python: 'python3' },
    ...overrides,
  })
  const adapter = new UpstreamAdapter(ctx, config)
  const runtime = new VisionToolkitRuntime(ctx, config, adapter)
  return { ctx, config, adapter, runtime }
}

const signal = new AbortController().signal

describe('VisionToolkitRuntime', () => {
  it('glance describes an image', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.glance({ images: ['sample.png'] }, { signal, workspace })
    expect(result.mode).toBe('describe')
    expect(result.answer).toBe('Fixture detailed description')
    expect(result.images[0]?.bytes).toBeGreaterThan(0)
  })

  it('glance answers a question, OCRs, and zooms into a region', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const qa = await runtime.glance({ images: ['sample.png'], query: 'what color?' }, { signal, workspace })
    expect(qa.mode).toBe('qa')
    expect(qa.answer).toBe('Fixture answer to the question')
    const ocr = await runtime.glance({ images: ['sample.png'], ocr: true }, { signal, workspace })
    expect(ocr.mode).toBe('ocr')
    expect(ocr.answer).toBe('Fixture OCR text')
    const region = await runtime.glance({ images: ['sample.png'], region: '10,10,30,30', query: 'x' }, { signal, workspace })
    expect(region.answer).toBe('Fixture answer to the question')
  })

  it('glance rejects region with multiple images and mutually exclusive modes', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    await expect(runtime.glance({ images: ['sample.png', 'sample.png'], region: '0,0,1,1' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
    await expect(runtime.glance({ images: ['sample.png'], query: 'x', ocr: true }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
  })

  it('ground returns normalized pixel boxes with image size', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.ground({ image: 'sample.png', target: 'send button' }, { signal, workspace })
    expect(result.imageWidth).toBe(256)
    expect(result.imageHeight).toBe(256)
    expect(result.matches).toEqual([{
      label: 'send button',
      box: { x1: 100, y1: 50, x2: 200, y2: 90 },
    }])
  })

  it('detect returns a numbered element inventory', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.detect({ image: 'sample.png', target: 'buttons' }, { signal, workspace })
    expect(result.category).toBe('buttons')
    expect(result.elements).toHaveLength(2)
    expect(result.elements[0]).toMatchObject({ index: 1, label: 'button' })
    expect(result.elements[1]).toMatchObject({ index: 2, label: 'input' })
  })

  it('crop writes an image file and reports dimensions', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.crop({ image: 'sample.png', region: '10,20,50,40' }, { signal, workspace })
    expect(result.outputPath).toContain('.dsh-vision-toolkit')
    expect(result.mimeType).toBe('image/png')
    expect(result.width).toBe(40)
    expect(result.height).toBe(20)
    expect(result.clamped).toBe(false)
  })

  it('trace writes an SVG and returns geometry facts', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const result = await runtime.trace({ image: 'sample.png' }, { signal, workspace })
    expect(result.mimeType).toBe('image/svg+xml')
    expect(result.outputPath).toContain('.dsh-vision-toolkit')
    expect(result.imageWidth).toBe(256)
    expect(result.geometry.status).toBe('production')
    expect(result.geometry.primitiveCount).toBe(1)
    expect(result.perception?.label).toBe('circle')
  })

  it('enforces the image byte limit as a capacity error', async () => {
    const { runtime } = await setup({ maxImageBytes: 1024 })
    const workspace = await tempWorkspace()
    await expect(runtime.glance({ images: ['sample.png'] }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'capacity' })
  })

  it('rejects missing images and malformed regions as input errors', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    await expect(runtime.ground({ image: 'missing.png', target: 'x' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
    await expect(runtime.crop({ image: 'sample.png', region: '1,2,3' }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'input' })
  })

  it('cancels immediately when the caller signal is already aborted', async () => {
    const { runtime } = await setup()
    const workspace = await tempWorkspace()
    const aborted = new AbortController()
    aborted.abort()
    await expect(runtime.glance({ images: ['sample.png'] }, { signal: aborted.signal, workspace }))
      .rejects.toMatchObject({ code: 'cancelled' })
  })

  it('rejects a missing credential as a config error', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessService)
    ctx.provide('credentials', {
      async resolve() {
        return undefined
      },
    } as unknown as Credentials)
    const config = resolveConfig({
      provider: { baseUrl: 'https://vision.example/v1', credential: 'MISSING_KEY', model: 'm' },
      runtime: { agentVisionToolkitPath: FIXTURE_UPSTREAM },
    })
    const runtime = new VisionToolkitRuntime(ctx, config, new UpstreamAdapter(ctx, config))
    const workspace = await tempWorkspace()
    await expect(runtime.glance({ images: ['sample.png'] }, { signal, workspace }))
      .rejects.toMatchObject({ code: 'config' })
  })
})

describe('createDeadline', () => {
  it('reports timeout when the timer fires first', async () => {
    const controller = new AbortController()
    const deadline = createDeadline(controller.signal, 20)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.timedOut).toBe(true)
    expect(deadline.cancelled).toBe(false)
    deadline.cleanup()
  })

  it('reports cancellation when the caller signal fires first', () => {
    const controller = new AbortController()
    const deadline = createDeadline(controller.signal, 1000)
    controller.abort()
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.timedOut).toBe(false)
    expect(deadline.cancelled).toBe(true)
    deadline.cleanup()
  })
})

describe('Semaphore', () => {
  it('bounds concurrent acquisitions and wakes the longest waiter', async () => {
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

describe('upstream adapter version facts', () => {
  it('reads the fixture checkout version marker', async () => {
    const { adapter } = await setup()
    await adapter.prepare()
    expect(adapter.versionInfo.path).toBe(FIXTURE_UPSTREAM)
    expect(await adapter.readCheckoutVersion()).toBe('v0.1.0-fixture')
  })

  it('fails prepare with a clear runtime error when scripts are missing', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessService)
    const config = resolveConfig({
      provider: { baseUrl: 'https://vision.example/v1', credential: 'K', model: 'm' },
      runtime: { agentVisionToolkitPath: '/nonexistent/toolkit' },
    })
    const adapter = new UpstreamAdapter(ctx, config)
    await expect(adapter.prepare()).rejects.toBeInstanceOf(VisionToolkitError)
  })
})
