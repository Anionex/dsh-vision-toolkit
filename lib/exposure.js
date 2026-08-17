/**
 * Agent-scoped progressive exposure for the model-facing visual tools.
 * Runtime readiness is global, while tool schemas enter only an Agent through
 * the matching Skill or its bootstrap tool; administrative diagnostics stay on
 * the Web seam.
 * @module dsh-vision-toolkit/exposure
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { VISION_SKILLS_CONTENT, VISION_SKILLS_NAME } from "./skill.js";
import { VISION_TOOL_NAMES } from "./tools.js";
/** Small bootstrap tool retained only until the current Agent gains visual tools. */
export const VISION_TOOLKIT_ACTIVATE = 'vision_toolkit_activate';
/** Skill name used by releases before the rename to vision-skills. */
export const LEGACY_VISION_TOOLS_SKILL_NAME = 'vision-tools';
/** Unique pre-rename line in bundled instructions, kept for Session restore. */
export const LEGACY_VISION_TOOLS_SKILL_MARKER = 'If this content arrived through a direct `/vision-tools` invocation and the';
function renderJson(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isBundledSkillName(name) {
    return name === VISION_SKILLS_NAME || name === LEGACY_VISION_TOOLS_SKILL_NAME;
}
function isBundledSkillContent(text) {
    return text.includes(VISION_SKILLS_CONTENT) || text.includes(LEGACY_VISION_TOOLS_SKILL_MARKER);
}
function isVisionSkillArguments(value) {
    return isRecord(value) && isBundledSkillName(value.name);
}
function nativeSkillCall(raw) {
    try {
        return isVisionSkillArguments(JSON.parse(raw));
    }
    catch {
        return false;
    }
}
function containsBundledSkillContent(blocks) {
    return blocks.some(block => isRecord(block)
        && block.type === 'text'
        && typeof block.text === 'string'
        && isBundledSkillContent(block.text));
}
function isBundledSkillResult(value) {
    return isRecord(value)
        && isBundledSkillName(value.name)
        && typeof value.content === 'string'
        && isBundledSkillContent(value.content);
}
/** Whether durable history proves that this Session loaded the bundled Skill. */
function hasLoadedVisionSkill(session) {
    const nativeCalls = new Set();
    for (const event of session.events) {
        if (event.type === 'user/message') {
            const source = event.data.source;
            if (source.kind === 'skill-invocation'
                && isBundledSkillName(source.name)
                && containsBundledSkillContent(event.data.content))
                return true;
            continue;
        }
        if (event.type === 'tool/call') {
            if (event.data.name === 'skill' && nativeSkillCall(event.data.arguments)) {
                nativeCalls.add(String(event.data.callId));
            }
            continue;
        }
        if (event.type === 'tool/result') {
            const [block] = event.data.message.content;
            if (block?.type === 'tool-result'
                && block.isError !== true
                && nativeCalls.has(String(block.toolCallId))
                && containsBundledSkillContent(block.content))
                return true;
            continue;
        }
        if (event.type === 'tool/code-dispatch'
            && event.data.name === 'skill'
            && event.data.isError === false
            && isVisionSkillArguments(event.data.arguments)
            && containsBundledSkillContent(event.data.content))
            return true;
    }
    return false;
}
/**
 * Owns one progressive-exposure generation for a ready Vision Toolkit runtime.
 * The bootstrap tool is global; visual definitions are created and registered
 * in an Agent scope after the Skill load is durable, just succeeded, or the
 * model explicitly invokes the bootstrap fallback.
 */
export class VisionToolExposure {
    ctx;
    createTools;
    activationTool;
    states = new Map();
    installed = false;
    /**
     * @param ctx - Plugin context with Tool and Agent registries.
     * @param createTools - Fresh definitions bound to the current runtime generation.
     */
    constructor(ctx, createTools) {
        this.ctx = ctx;
        this.createTools = createTools;
        this.activationTool = defineTool({
            name: VISION_TOOLKIT_ACTIVATE,
            description: `Activate the independent Vision Toolkit execution tools for this Agent: ${Object.values(VISION_TOOL_NAMES).join(', ')}. `
                + `Loading the ${VISION_SKILLS_NAME} Skill normally activates them automatically; call this once when the visual tools are still absent, then use them for image understanding, OCR, UI detection, and related tasks. `
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
            execute: (_args, exec) => {
                if (exec.agent === undefined) {
                    throw new Error(`${VISION_TOOLKIT_ACTIVATE}: an Agent Session is required`);
                }
                return Promise.resolve(this.activate(exec.agent));
            },
            presentCall: () => ({ card: 'generic', title: 'Activate vision tools', kind: 'execute' }),
        });
    }
    /** Install lifecycle listeners and adopt Agents that already exist. */
    install() {
        if (this.installed)
            throw new Error('dsh-vision-toolkit: progressive exposure is already installed');
        this.installed = true;
        const listeners = [
            this.ctx.on('agent/created', ({ agent }) => { this.attach(agent); }),
            this.ctx.on('agent/disposed', ({ agent }) => { this.detach(agent); }),
            this.ctx.on('session/event', (session, event) => {
                if (event.type === 'step/end')
                    this.applyHideActivationForSession(session);
            }),
            this.ctx.on('tools/result', (exec, result) => {
                if (result.isError === false
                    && exec.name === 'skill'
                    && exec.agent !== undefined
                    && isVisionSkillArguments(exec.arguments)
                    && isBundledSkillResult(result.value)) {
                    this.activate(exec.agent);
                }
                return undefined;
            }),
        ];
        try {
            for (const agent of this.ctx.agents.list())
                this.attach(agent);
        }
        catch (error) {
            for (const dispose of listeners.reverse())
                dispose();
            this.disposeStates();
            this.installed = false;
            throw error;
        }
        return () => {
            if (!this.installed)
                return;
            this.installed = false;
            for (const dispose of listeners.reverse())
                dispose();
            this.disposeStates();
        };
    }
    attach(agent) {
        if (this.states.has(agent))
            return;
        this.states.set(agent, { active: false, toolDisposers: [], toolNames: [] });
        if (hasLoadedVisionSkill(agent.session))
            this.activate(agent);
    }
    activate(agent) {
        this.attach(agent);
        const state = this.states.get(agent);
        /* v8 ignore next -- attach() synchronously creates this exact entry. */
        if (state === undefined)
            throw new Error(`dsh-vision-toolkit: Agent ${String(agent.id)} has no exposure state`);
        if (state.active)
            return { activated: false, tools: [...state.toolNames] };
        const definitions = this.createTools();
        const toolDisposers = [];
        try {
            for (const definition of definitions)
                toolDisposers.push(agent.ctx.tools.register(definition));
            // A Skill call and the bootstrap can be issued in the same model step.
            // Restricting immediately would turn the still-in-flight bootstrap call
            // into an UNKNOWN_TOOL error, so live sessions hide at step/end.
            if (!this.isLiveSession(agent.session))
                this.applyHideActivation(agent);
        }
        catch (error) {
            for (const dispose of toolDisposers.reverse())
                dispose();
            throw error;
        }
        state.active = true;
        state.toolDisposers = toolDisposers;
        state.toolNames = definitions.map(definition => definition.name);
        return { activated: true, tools: [...state.toolNames] };
    }
    /** Whether the session is attached to the live SessionStore (production). */
    isLiveSession(session) {
        return this.ctx.sessions.get(session.id) === session;
    }
    applyHideActivationForSession(session) {
        for (const agent of this.ctx.agents.list()) {
            if (agent.session === session && this.states.get(agent)?.active === true) {
                this.applyHideActivation(agent);
            }
        }
    }
    applyHideActivation(agent) {
        const state = this.states.get(agent);
        if (state === undefined || state.liftRestriction !== undefined)
            return;
        state.liftRestriction = agent.ctx.tools.restrict({ deny: [VISION_TOOLKIT_ACTIVATE] });
    }
    detach(agent) {
        const state = this.states.get(agent);
        if (state === undefined)
            return;
        this.states.delete(agent);
        this.disposeState(state);
    }
    disposeStates() {
        for (const state of this.states.values())
            this.disposeState(state);
        this.states.clear();
    }
    disposeState(state) {
        state.liftRestriction?.();
        for (const dispose of state.toolDisposers.reverse())
            dispose();
    }
}
//# sourceMappingURL=exposure.js.map