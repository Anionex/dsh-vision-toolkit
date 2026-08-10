import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
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
  })

  it('unregisters every tool and skill on dispose', async () => {
    const { ctx, fiber } = await setupContext(BUNDLED_UPSTREAM)
    expect(ctx.tools.schemas().some(tool => TOOL_NAMES.includes(tool.name))).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)
    const skills = await ctx.skills.list()
    expect(skills.find(entry => entry.name === 'vision-tools')).toBeUndefined()
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
