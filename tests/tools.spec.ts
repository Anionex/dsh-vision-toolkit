import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import SkillService from '@deepseek-ai/dsh-skill'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import * as VisionToolkit from '../src/index.ts'

const FIXTURE_UPSTREAM = fileURLToPath(new URL('./fixtures/upstream', import.meta.url))

const TOOL_NAMES = [
  'vision_glance',
  'vision_ground',
  'vision_detect',
  'vision_trace',
  'vision_crop',
  'vision_toolkit_version',
]

function fakeCredentials(): Credentials {
  return {
    async resolve() {
      return { value: 'test-vision-key', source: 'env' }
    },
  } as unknown as Credentials
}

async function setupContext(toolkitPath: string) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(SkillService)
  await ctx.plugin(LocalSubprocessService)
  ctx.provide('credentials', fakeCredentials())
  const fiber = await ctx.plugin(VisionToolkit, {
    provider: {
      baseUrl: 'https://vision.example/v1',
      credential: 'VISION_API_KEY',
      model: 'fixture-model',
    },
    runtime: { agentVisionToolkitPath: toolkitPath, python: 'python3' },
  })
  return { ctx, fiber }
}

describe('dsh-vision-toolkit plugin lifecycle', () => {
  it('registers the six native tools and the vision-tools skill after runtime preparation', async () => {
    const { ctx } = await setupContext(FIXTURE_UPSTREAM)
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
    const { ctx, fiber } = await setupContext(FIXTURE_UPSTREAM)
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
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SkillService)
    await ctx.plugin(LocalSubprocessService)
    ctx.provide('credentials', fakeCredentials())
    await expect(ctx.plugin(VisionToolkit, {
      provider: { baseUrl: 'not-a-url', credential: 'K', model: 'm' },
    })).rejects.toMatchObject({ code: 'config' })
  })

  it('exposes the pinned upstream version through vision_toolkit_version', async () => {
    const { ctx } = await setupContext(FIXTURE_UPSTREAM)
    const definition = ctx.tools.get('vision_toolkit_version')
    expect(definition).toBeDefined()
    expect(definition?.parameters).toBeDefined()
    expect(typeof definition?.output.render).toBe('function')
    expect(typeof definition?.execute).toBe('function')
  })

  it('declares model-friendly parameters and JSON object outputs for every tool', async () => {
    const { ctx } = await setupContext(FIXTURE_UPSTREAM)
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
})
