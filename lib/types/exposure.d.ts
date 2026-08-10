/**
 * Agent-scoped progressive exposure for the model-facing visual tools.
 * Runtime readiness is global, while tool schemas enter only an Agent that has
 * loaded the matching Skill; administrative diagnostics stay on the Web seam.
 * @module dsh-vision-toolkit/exposure
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { Context } from 'cordis';
/** Small bootstrap tool retained only until the current Agent gains visual tools. */
export declare const VISION_TOOLKIT_ACTIVATE = "vision_toolkit_activate";
/** Result returned by the one-shot activation transport. */
export interface VisionToolkitActivationResult {
    activated: boolean;
    tools: string[];
}
/**
 * Owns one progressive-exposure generation for a ready Vision Toolkit runtime.
 * The bootstrap tool is global; visual definitions are created and registered
 * in an Agent scope only after the Skill load is durable or just succeeded.
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
    private detach;
    private disposeStates;
    private disposeState;
}
//# sourceMappingURL=exposure.d.ts.map