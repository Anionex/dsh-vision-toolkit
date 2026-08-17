/**
 * Agent-scoped progressive exposure for the model-facing visual tools.
 * Runtime readiness is global, while tool schemas enter only an Agent through
 * the matching Skill or its bootstrap tool; administrative diagnostics stay on
 * the Web seam.
 * @module dsh-vision-toolkit/exposure
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { VISION_TOOLS_SKILL_CONTENT, VISION_TOOLS_SKILL_NAME } from './skill.ts'
import { VISION_TOOL_NAMES } from './tools.ts'

/** Small bootstrap tool retained only until the current Agent gains visual tools. */
export const VISION_TOOLKIT_ACTIVATE = 'vision_toolkit_activate'

interface AgentExposure {
  active: boolean
  hideActivation?: () => void
  toolDisposers: Array<() => void>
  toolNames: string[]
}

/** Result returned by the one-shot activation transport. */
export interface VisionToolkitActivationResult {
  activated: boolean
  tools: string[]
}

function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isVisionSkillArguments(value: unknown): boolean {
  return isRecord(value) && value.name === VISION_TOOLS_SKILL_NAME
}

function nativeSkillCall(raw: string): boolean {
  try {
    return isVisionSkillArguments(JSON.parse(raw))
  } catch {
    return false
  }
}

function containsBundledSkillContent(blocks: readonly unknown[]): boolean {
  return blocks.some(block => isRecord(block)
    && block.type === 'text'
    && typeof block.text === 'string'
    && block.text.includes(VISION_TOOLS_SKILL_CONTENT))
}

function isBundledSkillResult(value: unknown): boolean {
  return isRecord(value)
    && value.name === VISION_TOOLS_SKILL_NAME
    && value.content === VISION_TOOLS_SKILL_CONTENT
}

/** Whether durable history proves that this Session loaded the bundled Skill. */
function hasLoadedVisionSkill(session: Session): boolean {
  const nativeCalls = new Set<string>()
  for (const event of session.events) {
    if (event.type === 'user/message') {
      const source = event.data.source
      if (source.kind === 'skill-invocation'
        && source.name === VISION_TOOLS_SKILL_NAME
        && containsBundledSkillContent(event.data.content)) return true
      continue
    }
    if (event.type === 'tool/call') {
      if (event.data.name === 'skill' && nativeSkillCall(event.data.arguments)) {
        nativeCalls.add(String(event.data.callId))
      }
      continue
    }
    if (event.type === 'tool/result') {
      const [block] = event.data.message.content
      if (block?.type === 'tool-result'
        && block.isError !== true
        && nativeCalls.has(String(block.toolCallId))
        && containsBundledSkillContent(block.content)) return true
      continue
    }
    if (event.type === 'tool/code-dispatch'
      && event.data.name === 'skill'
      && event.data.isError === false
      && isVisionSkillArguments(event.data.arguments)
      && containsBundledSkillContent(event.data.content)) return true
  }
  return false
}

/**
 * Owns one progressive-exposure generation for a ready Vision Toolkit runtime.
 * The bootstrap tool is global; visual definitions are created and registered
 * in an Agent scope after the Skill load is durable, just succeeded, or the
 * model explicitly invokes the bootstrap fallback.
 */
export class VisionToolExposure {
  readonly activationTool: ToolDefinition
  private readonly states = new Map<Agent, AgentExposure>()
  private installed = false

  /**
   * @param ctx - Plugin context with Tool and Agent registries.
   * @param createTools - Fresh definitions bound to the current runtime generation.
   */
  constructor(
    private readonly ctx: Context,
    private readonly createTools: () => ToolDefinition[],
  ) {
    this.activationTool = defineTool({
      name: VISION_TOOLKIT_ACTIVATE,
      description: `Activate the independent Vision Toolkit execution tools for this Agent: ${Object.values(VISION_TOOL_NAMES).join(', ')}. `
        + `Loading the ${VISION_TOOLS_SKILL_NAME} Skill normally activates them automatically; call this once when the visual tools are still absent, then use them for image understanding, OCR, UI detection, and related tasks. `
        + 'It is safe to call before the Skill is loaded, and this activation tool disappears after success.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            activated: { type: 'boolean', required: true },
            tools: { type: 'array', items: { type: 'string' }, required: true },
          },
        },
        render: renderJson,
      },
      execute: (_args, exec): Promise<VisionToolkitActivationResult> => {
        if (exec.agent === undefined) {
          throw new Error(`${VISION_TOOLKIT_ACTIVATE}: an Agent Session is required`)
        }
        return Promise.resolve(this.activate(exec.agent))
      },
      presentCall: () => ({ card: 'generic', title: 'Activate vision tools', kind: 'execute' }),
    })
  }

  /** Install lifecycle listeners and adopt Agents that already exist. */
  install(): () => void {
    if (this.installed) throw new Error('dsh-vision-toolkit: progressive exposure is already installed')
    this.installed = true
    const listeners = [
      this.ctx.on('agent/created', ({ agent }) => { this.attach(agent) }),
      this.ctx.on('agent/disposed', ({ agent }) => { this.detach(agent) }),
      this.ctx.on('tools/result', (exec, result) => {
        if (result.isError === false
          && exec.name === 'skill'
          && exec.agent !== undefined
          && isVisionSkillArguments(exec.arguments)
          && isBundledSkillResult(result.value)) {
          this.activate(exec.agent)
        }
        return undefined
      }),
    ]
    try {
      for (const agent of this.ctx.agents.list()) this.attach(agent)
    } catch (error) {
      for (const dispose of listeners.reverse()) dispose()
      this.disposeStates()
      this.installed = false
      throw error
    }
    return () => {
      if (!this.installed) return
      this.installed = false
      for (const dispose of listeners.reverse()) dispose()
      this.disposeStates()
    }
  }

  private attach(agent: Agent): void {
    if (this.states.has(agent)) return
    this.states.set(agent, { active: false, toolDisposers: [], toolNames: [] })
    if (hasLoadedVisionSkill(agent.session)) this.activate(agent)
  }

  private activate(agent: Agent): VisionToolkitActivationResult {
    this.attach(agent)
    const state = this.states.get(agent)
    /* v8 ignore next -- attach() synchronously creates this exact entry. */
    if (state === undefined) throw new Error(`dsh-vision-toolkit: Agent ${String(agent.id)} has no exposure state`)
    if (state.active) return { activated: false, tools: [...state.toolNames] }

    const definitions = this.createTools()
    const toolDisposers: Array<() => void> = []
    let hideActivation: (() => void) | undefined
    try {
      for (const definition of definitions) toolDisposers.push(agent.ctx.tools.register(definition))
      hideActivation = agent.ctx.tools.restrict({ deny: [VISION_TOOLKIT_ACTIVATE] })
    } catch (error) {
      hideActivation?.()
      for (const dispose of toolDisposers.reverse()) dispose()
      throw error
    }

    state.active = true
    state.hideActivation = hideActivation
    state.toolDisposers = toolDisposers
    state.toolNames = definitions.map(definition => definition.name)
    return { activated: true, tools: [...state.toolNames] }
  }

  private detach(agent: Agent): void {
    const state = this.states.get(agent)
    if (state === undefined) return
    this.states.delete(agent)
    this.disposeState(state)
  }

  private disposeStates(): void {
    for (const state of this.states.values()) this.disposeState(state)
    this.states.clear()
  }

  private disposeState(state: AgentExposure): void {
    state.hideActivation?.()
    for (const dispose of state.toolDisposers.reverse()) dispose()
  }
}
