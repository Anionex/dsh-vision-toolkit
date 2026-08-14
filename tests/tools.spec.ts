import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { defineTool } from '@deepseek-ai/dsh-tools'
import SkillService from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import Settings, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { SubprocessService } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import * as VisionToolkit from '../src/index.ts'
import { VISION_TOOLKIT_ACTIVATE } from '../src/exposure.ts'
import { bundledUpstreamRoot } from '../src/runtime-install.ts'
import { VISION_TOOLS_SKILL_CONTENT } from '../src/skill.ts'

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
const agentCleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(agentCleanups.splice(0).map(cleanup => cleanup()))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function recordDirectSkillInvocation(
  session: Session,
  turn = 1,
  content = VISION_TOOLS_SKILL_CONTENT,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: content }],
    source: { kind: 'skill-invocation', name: 'vision-tools', form: 'instructions' },
  }), { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function recordNativeSkillInvocation(
  session: Session,
  turn = 1,
  content = VISION_TOOLS_SKILL_CONTENT,
): void {
  const callId = CallId(`restored-skill-${turn}`)
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('tool/call', {
    turn,
    step: 1,
    callId,
    name: 'skill',
    arguments: JSON.stringify({ name: 'vision-tools' }),
  })
  session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: content }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function recordCodeSkillInvocation(
  session: Session,
  turn = 1,
  content = VISION_TOOLS_SKILL_CONTENT,
): void {
  session.append('turn/start', { turn })
  session.append('tool/code-dispatch', {
    parentCallId: CallId(`restored-run-code-${turn}`),
    subCallId: CallId(`restored-code-skill-${turn}`),
    name: 'skill',
    arguments: { name: 'vision-tools' },
    isError: false,
    content: [{ type: 'text', text: content }],
  })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

async function registerAgent(ctx: Context, name: string, session?: Session): Promise<Agent> {
  const id = SessionId(name)
  const ownedSession = session ?? Session.create(id)
  let agent!: Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    agent = { id, session: ownedSession } as Agent
    scope = createScope(inner, agent)
    Object.assign(agent, { ctx: scope.ctx })
  }, { inject: ['tools', 'systemPrompt'] }))
  const unregister = ctx.agents.register(agent)
  agentCleanups.push(async () => {
    unregister()
    await scope.dispose()
  })
  return agent
}

async function loadVisionSkill(ctx: Context, agent: Agent): Promise<void> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`skill-${String(agent.id)}`),
    name: 'skill',
    arguments: { name: 'vision-tools' },
    agent,
  })
  expect(result.isError, JSON.stringify(result)).toBe(false)
}

async function setupContext(toolkitPath: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillService)
  await ctx.plugin(ToolSkill)
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
  it('keeps visual schemas hidden until the matching Skill loads for one Agent', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain(VISION_TOOLKIT_ACTIVATE)
    expect(ctx.tools.schemas().some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)
    const skills = await ctx.skills.list()
    const skill = skills.find(entry => entry.name === 'vision-tools')
    expect(skill).toBeDefined()
    expect(skill?.description).toContain('vision_glance')
    expect(skill?.provider).toBe('runtime')
    const definition = await ctx.skills.get('vision-tools')
    expect(definition?.content).toContain('untrusted visual evidence')
    expect(definition?.content).toContain('vision_toolkit_activate')
    expect(definition?.content).toContain('never enter the model tool set')
    expect(definition?.content).toContain('immediately repeated vision_glance')
    expect(definition?.content).toContain('Disabling or unloading the plugin cancels')

    const activated = await registerAgent(ctx, 'activated')
    const untouched = await registerAgent(ctx, 'untouched')
    expect(ctx.tools.schemas(activated).map(tool => tool.name)).toContain(VISION_TOOLKIT_ACTIVATE)
    expect(ctx.tools.schemas(activated).some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)

    await loadVisionSkill(ctx, activated)
    await loadVisionSkill(ctx, activated)
    const activatedNames = ctx.tools.schemas(activated).map(tool => tool.name)
    for (const name of TOOL_NAMES) expect(activatedNames).toContain(name)
    expect(activatedNames).not.toContain(VISION_TOOLKIT_ACTIVATE)
    expect(ctx.tools.schemas(untouched).map(tool => tool.name)).toContain(VISION_TOOLKIT_ACTIVATE)
    expect(ctx.tools.schemas(untouched).some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)
  })

  it('restores native Skill activation before a persisted Agent is registered', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const session = Session.create(SessionId('restored-native-skill'))
    recordNativeSkillInvocation(session)

    const agent = await registerAgent(ctx, 'restored-native-skill', session)
    const names = ctx.tools.schemas(agent).map(tool => tool.name)
    for (const name of TOOL_NAMES) expect(names).toContain(name)
    expect(names).not.toContain(VISION_TOOLKIT_ACTIVATE)
  })

  it('restores Code Mode Skill activation before a persisted Agent is registered', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const session = Session.create(SessionId('restored-code-skill'))
    recordCodeSkillInvocation(session)

    const agent = await registerAgent(ctx, 'restored-code-skill', session)
    const names = ctx.tools.schemas(agent).map(tool => tool.name)
    for (const name of TOOL_NAMES) expect(names).toContain(name)
    expect(names).not.toContain(VISION_TOOLKIT_ACTIVATE)
  })

  it('unregisters every tool and skill on dispose', async () => {
    const { ctx, fiber } = await setupContext(BUNDLED_UPSTREAM)
    const agent = await registerAgent(ctx, 'dispose')
    await loadVisionSkill(ctx, agent)
    expect(ctx.tools.schemas(agent).some(tool => TOOL_NAMES.includes(tool.name))).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas(agent).some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)
    expect(ctx.tools.get(VISION_TOOLKIT_ACTIVATE)).toBeUndefined()
    const skills = await ctx.skills.list()
    expect(skills.find(entry => entry.name === 'vision-tools')).toBeUndefined()
  })

  it('supports the one-shot activation fallback after direct Skill invocation', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const session = Session.create(SessionId('direct-skill'))
    const agent = await registerAgent(ctx, 'direct-skill', session)
    recordDirectSkillInvocation(session)
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toContain(VISION_TOOLKIT_ACTIVATE)

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('activate-after-direct-skill'),
      name: VISION_TOOLKIT_ACTIVATE,
      arguments: {},
      agent,
    })
    expect(result.isError, JSON.stringify(result)).toBe(false)

    const names = ctx.tools.schemas(agent).map(tool => tool.name)
    for (const name of TOOL_NAMES) expect(names).toContain(name)
    expect(names).not.toContain(VISION_TOOLKIT_ACTIVATE)
  })

  it('does not activate from a same-name scoped Skill shadow', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const agent = await registerAgent(ctx, 'shadowed-skill')
    agent.ctx.tools.register(defineTool({
      name: 'skill',
      description: 'Test-only same-name shadow.',
      parameters: { name: { type: 'string', required: true } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            content: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: () => Promise.resolve({ name: 'vision-tools', content: 'unrelated instructions' }),
    }))

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('shadowed-skill-call'),
      name: 'skill',
      arguments: { name: 'vision-tools' },
      agent,
    })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(ctx.tools.schemas(agent).some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toContain(VISION_TOOLKIT_ACTIVATE)
  })

  it('rejects same-name direct Skill evidence with non-bundled content', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const session = Session.create(SessionId('foreign-direct-skill'))
    const agent = await registerAgent(ctx, 'foreign-direct-skill', session)
    recordDirectSkillInvocation(session, 1, '# unrelated vision-tools instructions')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('activate-after-foreign-direct-skill'),
      name: VISION_TOOLKIT_ACTIVATE,
      arguments: {},
      agent,
    })
    expect(result.isError).toBe(true)
    expect(ctx.tools.schemas(agent).some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)
  })

  it('rejects activation when the Skill has not been loaded', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const agent = await registerAgent(ctx, 'no-skill')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('activate-without-skill'),
      name: VISION_TOOLKIT_ACTIVATE,
      arguments: {},
      agent,
    })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('load the vision-tools Skill first') }])
    expect(ctx.tools.schemas(agent).some(tool => TOOL_NAMES.includes(tool.name))).toBe(false)
  })

  it('cancels an in-flight upstream tool when the plugin is disposed', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillService)
    await ctx.plugin(ToolSkill)
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
    const agent = await registerAgent(ctx, 'dispose-active')
    await loadVisionSkill(ctx, agent)
    const pending = ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('dispose-active-vision-tool'),
      name: 'vision_glance',
      arguments: { images: [SAMPLE_IMAGE] },
      agent,
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
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillService)
    await ctx.plugin(ToolSkill)
    await ctx.plugin(ProbeSubprocessService)
    await ctx.plugin(MemorySettings)
    ctx.provide('credentials', fakeCredentials())
    await expect(ctx.plugin(VisionToolkit, {
      provider: { baseUrl: 'not-a-url', credential: 'K', model: 'm' },
    })).rejects.toMatchObject({ code: 'config' })
  })

  it('declares model-friendly parameters and JSON object outputs for every tool', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const agent = await registerAgent(ctx, 'schemas')
    await loadVisionSkill(ctx, agent)
    for (const name of TOOL_NAMES) {
      const definition = ctx.tools.get(name, agent)
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
    expect(ctx.tools.get('vision_toolkit_health')).toBeUndefined()
    expect(ctx.tools.get('vision_toolkit_version')).toBeUndefined()
  })

  it('declares replay-safe file locations and presentation metadata for artifact tools', async () => {
    const { ctx } = await setupContext(BUNDLED_UPSTREAM)
    const agent = await registerAgent(ctx, 'presentation')
    await loadVisionSkill(ctx, agent)
    const ground = ctx.tools.get('vision_ground', agent)
    expect(ground?.presentCall?.({ image: 'shot.png', target: 'send', preview: true })).toMatchObject({
      card: 'generic',
      locations: [{ path: 'shot.png' }],
    })
    const pixelDiff = ctx.tools.get('vision_pixel_diff', agent)
    expect(pixelDiff?.presentCall?.({ original: 'reference.png', rebuilt: 'actual.png' })).toMatchObject({
      locations: [{ path: 'reference.png' }, { path: 'actual.png' }],
    })
    expect(typeof pixelDiff?.output.presentationMeta).toBe('function')
  })
})
