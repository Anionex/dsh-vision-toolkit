import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import { resolveConfig } from '../src/config.ts'
import type { PreparedUpstreamRuntime } from '../src/runtime-install.ts'
import { UpstreamAdapter } from '../src/upstream.ts'

const execFileAsync = promisify(execFile)
const FIXTURE_UPSTREAM = fileURLToPath(new URL('./fixtures/upstream', import.meta.url))
const tempDirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dvt-image-compress-'))
  tempDirs.push(dir)
  return dir
}

async function makeImage(path: string, script: string): Promise<void> {
  await execFileAsync('python3', ['-c', script])
}

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

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
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
    runtime: { mode: 'external', agentVisionToolkitPath: FIXTURE_UPSTREAM, python: 'python3' },
  })
  return { adapter: new UpstreamAdapter(ctx, config, preparedFixture()) }
}

const signal = new AbortController().signal

describe('UpstreamAdapter.compressImage', () => {
  it('prefers a lossless re-encode when it fits the byte budget', async () => {
    const { adapter } = await setup()
    const root = await tempDir()
    const source = join(root, 'flat.png')
    const dest = join(root, 'flat-out')
    await makeImage(source, `from PIL import Image; im=Image.new("RGB",(800,800),(200,100,50)); im.save(${JSON.stringify(source)})`)

    const result = await adapter.compressImage(source, dest, 3000, 20_000_000, { signal })
    expect(result.lossy).toBe(false)
    expect(['png', 'webp']).toContain(result.format)
    expect(result.bytes).toBeLessThanOrEqual(3000)
    await expect(readFile(dest)).resolves.toBeDefined()
  }, 60_000)

  it('compresses a large noisy PNG below the byte budget', async () => {
    const { adapter } = await setup()
    const root = await tempDir()
    const source = join(root, 'noisy.png')
    const dest = join(root, 'noisy-out')
    await makeImage(source, [
      'from PIL import Image',
      'noise=Image.merge("RGB",(Image.effect_noise((1600,1600),90),Image.effect_noise((1600,1600),110),Image.effect_noise((1600,1600),130)))',
      `noise.save(${JSON.stringify(source)})`,
    ].join('\n'))

    const result = await adapter.compressImage(source, dest, 4 * 1024 * 1024, 20_000_000, { signal })
    expect(result.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(result.width * result.height).toBeLessThanOrEqual(20_000_000)
    expect(['png', 'jpeg', 'webp']).toContain(result.format)
    await expect(readFile(dest)).resolves.toBeDefined()
  }, 120_000)

  it('re-encodes a large JPEG below the byte budget', async () => {
    const { adapter } = await setup()
    const root = await tempDir()
    const source = join(root, 'noisy.jpg')
    const dest = join(root, 'noisy-jpeg-out')
    await makeImage(source, [
      'from PIL import Image',
      'noise=Image.merge("RGB",(Image.effect_noise((2000,1500),90),Image.effect_noise((2000,1500),110),Image.effect_noise((2000,1500),130)))',
      `noise.save(${JSON.stringify(source)},quality=95)`,
    ].join('\n'))

    const result = await adapter.compressImage(source, dest, 4 * 1024 * 1024, 20_000_000, { signal })
    expect(result.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(['jpeg', 'webp']).toContain(result.format)
    await expect(readFile(dest)).resolves.toBeDefined()
  }, 120_000)

  it('downscales when the pixel budget requires it', async () => {
    const { adapter } = await setup()
    const root = await tempDir()
    const source = join(root, 'pixel.png')
    const dest = join(root, 'pixel-out')
    await makeImage(source, `from PIL import Image; im=Image.new("RGB",(800,800),(10,20,30)); im.save(${JSON.stringify(source)})`)

    const result = await adapter.compressImage(source, dest, 4 * 1024 * 1024, 100_000, { signal })
    expect(result.width * result.height).toBeLessThanOrEqual(100_000)
    expect(result.resized).toBe(true)
  }, 60_000)

  it('throws a capacity error when even the minimum image cannot fit', async () => {
    const { adapter } = await setup()
    const root = await tempDir()
    const source = join(root, 'tiny.png')
    const dest = join(root, 'tiny-out')
    await makeImage(source, `from PIL import Image; im=Image.new("RGB",(64,64),(1,2,3)); im.save(${JSON.stringify(source)})`)

    await expect(adapter.compressImage(source, dest, 8, 100_000, { signal }))
      .rejects.toMatchObject({ code: 'capacity' })
  }, 60_000)
})
