/**
 * Agent-scoped progressive exposure for the model-facing visual tools.
 * Runtime readiness is global, while tool schemas enter only an Agent through
 * the matching Skill or its bootstrap tool; administrative diagnostics stay on
 * the Web seam.
 * @module dsh-vision-toolkit/exposure
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { Context } from '@deepseek-ai/cordis';
/** Small bootstrap tool retained only until the current Agent gains visual tools. */
export declare const VISION_TOOLKIT_ACTIVATE = "vision_toolkit_activate";
/** Skill name used by releases before the rename to vision-skills. */
export declare const LEGACY_VISION_TOOLS_SKILL_NAME = "vision-tools";
/** Unique pre-rename line in bundled instructions, kept for Session restore. */
export declare const LEGACY_VISION_TOOLS_SKILL_MARKER = "If this content arrived through a direct `/vision-tools` invocation and the";
/** Result returned by the one-shot activation transport. */
export interface VisionToolkitActivationResult {
    activated: boolean;
    tools: string[];
}
/**
 * Owns one progressive-exposure generation for a ready Vision Toolkit runtime.
 * The bootstrap tool is global; visual definitions are created and registered
 * in an Agent scope after the Skill load is durable, just succeeded, or the
 * model explicitly invokes the bootstrap fallback.
 */
export declare class VisionToolExposure {
    private readonly ctx;
    private readonly createTools;
    readonly activationTool: ToolDefinition;
    private readonly states;
    private installed;
    /**
     * @param ctx - Plugin context with Tool and Agent registries.
     * @param createTools - Fresh definitions bound to the current runtime generation.
     */
    constructor(ctx: Context, createTools: () => ToolDefinition[]);
    /** Install lifecycle listeners and adopt Agents that already exist. */
    install(): () => void;
    private attach;
    private activate;
    /** Whether the session is attached to the live SessionStore (production). */
    private isLiveSession;
    private applyHideActivationForSession;
    private applyHideActivation;
    private detach;
    private disposeStates;
    private disposeState;
}
//# sourceMappingURL=exposure.d.ts.map