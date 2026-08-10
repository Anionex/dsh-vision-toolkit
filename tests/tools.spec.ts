import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import SkillService from '@deepseek-ai/dsh-skill'
import Settings, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { SubprocessService } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import * as VisionToolkit from '../src/index.ts'
import { bundledUpstreamRoot } from '../src/runtime-install.ts'

const BUNDLED_UPSTREAM = bundledUpstreamRoot()
const SAMPLE_IMAGE = fileURLToPath(new URL('./fixtures/sample.png', import.meta.url))

const TOOL_NAMES = [
  'vision_glance',
  'vision_ground',
  'vision_detect',
  'vision_trace',
  'vision_crop',
  'vision_pixel_diff',
  'vision_long_screenshot_ocr',
  'vision_extract_foreground',
  'vision_dominant_colors',
  'vision_html_screenshot',
  'vision_toolkit_health',
  'vision_toolkit_version',
]

function fakeCredentials(): Credentials {
  return {
    async resolve() {
      return { value: 'test-vision-key', source: 'env' }
    },
  } as unknown as Credentials
}

class ProbeSubprocessService extends SubprocessService {
  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const command = spec.argv.join('\n')
    const stdout = command.includes('sys.version_info')
      ? '{"version":"3.12.0","major":3,"minor":12}\n'
      : command.includes('with Image.open')
        ? '{"width":256,"height":256,"format":"png","mode":"RGBA"}\n'
        : command.includes('import PIL')
          ? '{"pillow":"12.3.0","numpy":"2.5.1","vtracer":"0.6.15"}\n'
          : ''
    const read = (text: string): SubprocessOutputRead => ({ text, nextOffset: Buffer.byteLength(text), lossy: false })
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: { readFrom: () => read(stdout) },
        stderr: { readFrom: () => read('') },
      },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }
}

class BlockingSubprocessService extends ProbeSubprocessService {
  private announceStart: (() => void) | undefined
  readonly started = new Promise<void>((resolve) => { this.announceStart = resolve })
  aborted = false

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (!spec.argv.some(arg => arg.endsWith('/bin/glance'))) return super.spawn(spec)
    this.announceStart?.()
    this.announceStart = undefined
    const read = (): SubprocessOutputRead => ({ text: '', nextOffset: 0, lossy: false })
    let settle: ((outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | undefined
    let settled = false
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => { settle = resolve })
    const finish = (): void => {
      if (settled) return
      settled = true
      this.aborted = true
      settle?.({ exitCode: null, signal: 'SIGTERM' })
    }
    if (spec.signal?.aborted === true) queueMicrotask(finish)
    else spec.signal?.addEventListener('abort', finish, { once: true })
    return {
      pid: 2,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: { readFrom: read }, stderr: { readFrom: read } },
      done,
      terminate: finish,
      waitForExit: () => done.then(() => true),
    }
  }
}

class MemorySettings extends Settings {
  readonly writable = true
  private document: Record<string, unknown> = {}

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(this.document)
  }

  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.document = { ...this.document, [ns]: section }
    return Promise.resolve()
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setupContext(toolkitPath: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(SkillService)
  await ctx.plugin(ProbeSubprocessService)
  await ctx.plugin(MemorySettings)
  ctx.provide('credentials', fakeCredentials())
  const fiber = await ctx.plugin(VisionToolkit, {
    provider: {
      baseUrl: 'https://vision.example/v1',
      credential: 'VISION_API_KEY',
      model: 'fixture-model',
    },
    runtime: { mode: 'external', agentVisionToolkitPath: toolkitPath, python: 'python3' },
  })
  return { ctx, fiber }
}

describe('dsh-vision-toolkit plugin lifecycle', () => {
  it('registers the complete P0/P1 native tool set and skill after runtime preparation', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    // `ctx.plugin` settles only after the async apply finishes, so readiness
    // work (upstream probe + registration) must be visible immediately.
    const names = ctx.tools.schemas().map(tool => tool.name)
    for (const name of TOOL_NAMES) {
      expect(names).toContain(name)
    }
    const skills = await ctx.skills.list()
    const skill = skills.find(entry => entry.name === 'vision-tools')
    expect(skill).toBeDefined()
    expect(skill?.description).toContain('vision_glance')
    expect(skill?.provider).toBe('runtime')
    const definition = await ctx.skills.get('vision-tools')
    expect(definition?.content).toContain('untrusted visual evidence')
    expect(definition?.content).toContain('immediately repeated vision_glance')
    expect(definition?.content).toContain('Disabling or unloading the plugin cancels')
  })

  it('unregisters every tool and skill on dispose', async () => {
    const { ctx, fiber } = await setupContext(BUNDLED_UPSTREAM)
    expect(ctx.tools.schemas().some(tool => TOOL_NAMES.includes(tool.name))).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)
    const skills = await ctx.skills.list()
    expect(skills.find(entry => entry.name === 'vision-tools')).toBeUndefined()
  })

  it('cancels an in-flight upstream tool when the plugin is disposed', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SkillService)
    await ctx.plugin(MemorySettings)
    const subprocessFiber = await ctx.plugin(BlockingSubprocessService)
    const subprocess = subprocessFiber.ctx.subprocess as BlockingSubprocessService
    ctx.provide('credentials', fakeCredentials())
    const fiber = await ctx.plugin(VisionToolkit, {
      provider: {
        baseUrl: 'https://vision.example/v1',
        credential: 'VISION_API_KEY',
        model: 'fixture-model',
      },
      runtime: { mode: 'external', agentVisionToolkitPath: BUNDLED_UPSTREAM, python: 'python3' },
    })
    const pending = ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('dispose-active-vision-tool'),
      name: 'vision_glance',
      arguments: { images: [SAMPLE_IMAGE] },
    })

    await Promise.race([
      subprocess.started,
      pending.then((result) => { throw new Error(`vision_glance settled before spawning: ${JSON.stringify(result)}`) }),
    ])
    await fiber.dispose()
    const result = await pending
    expect(subprocess.aborted).toBe(true)
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('cancelled') }])
  })

  it('registers nothing when the upstream runtime is missing', async () => {
    const { ctx } = await setupContext('/nonexistent/vision-toolkit')
    expect(ctx.tools.schemas().some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)
    const skills = await ctx.skills.list()
    expect(skills.find(entry => entry.name === 'vision-tools')).toBeUndefined()
  })

  it('fails loud on invalid configuration at plugin load', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SkillService)
    await ctx.plugin(ProbeSubprocessService)
    await ctx.plugin(MemorySettings)
    ctx.provide('credentials', fakeCredentials())
    await expect(ctx.plugin(VisionToolkit, {
      provider: { baseUrl: 'not-a-url', credential: 'K', model: 'm' },
    })).rejects.toMatchObject({ code: 'config' })
  })

  it('exposes the pinned upstream version through vision_toolkit_version', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const definition = ctx.tools.get('vision_toolkit_version')
    expect(definition).toBeDefined()
    expect(definition?.parameters).toBeDefined()
    expect(typeof definition?.output.render).toBe('function')
    expect(typeof definition?.execute).toBe('function')
  })

  it('declares model-friendly parameters and JSON object outputs for every tool', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    for (const name of TOOL_NAMES) {
      const definition = ctx.tools.get(name)
      expect(definition, name).toBeDefined()
      expect(definition?.description?.length, `${name} description`).toBeGreaterThan(0)
      if (['vision_glance', 'vision_ground', 'vision_detect', 'vision_long_screenshot_ocr'].includes(name)) {
        expect(definition?.description, `${name} trust boundary`).toContain('untrusted visual evidence')
      }
      const output = definition?.output as { schema?: { type?: string } } | undefined
      expect(output?.schema?.type, `${name} output`).toBe('object')
      const blocks = definition?.output.render({}, { kind: 'ok' })
      expect(blocks?.[0]).toMatchObject({ type: 'text' })
    }
  })

  it('declares replay-safe file locations and presentation metadata for artifact tools', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const ground = ctx.tools.get('vision_ground')
    expect(ground?.presentCall?.({ image: 'shot.png', target: 'send', preview: true })).toMatchObject({
      card: 'generic',
      locations: [{ path: 'shot.png' }],
    })
    const pixelDiff = ctx.tools.get('vision_pixel_diff')
    expect(pixelDiff?.presentCall?.({ original: 'reference.png', rebuilt: 'actual.png' })).toMatchObject({
      locations: [{ path: 'reference.png' }, { path: 'actual.png' }],
    })
    expect(typeof pixelDiff?.output.presentationMeta).toBe('function')
  })
})
