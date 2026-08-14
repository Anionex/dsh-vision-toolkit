/**
 * @dsh-external/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Plugin lifecycle follows the documented readiness chain: verify the pinned
 * upstream checkout, publish the vision-tools Skill and its one-shot bootstrap,
 * then mount the execution tools only in Agents that load that Skill. Any
 * failure leaves no model capability behind, and disposal unregisters every
 * global and Agent-scoped contribution the plugin mounted.
 * @module @dsh-external/dsh-vision-toolkit
 */
import { ArtifactAccessController, prepareArtifactAccessKey } from "./artifact-access.js";
import { messagesContainImage, savePastedImages, stripImageBlocks } from "./degrade.js";
import { Config, VISION_TOOLKIT_SETTINGS_NAMESPACE, resolveConfig, } from "./config.js";
import { VisionToolExposure } from "./exposure.js";
import { VisionToolkitRuntimeManager } from "./runtime-manager.js";
import { VISION_TOOLS_SKILL } from "./skill.js";
import { createVisionTools } from "./tools.js";
import { PLUGIN_VERSION } from "./version.js";
import { installVisionToolkitWeb, VisionToolkitWebBackend } from "./web.js";
export const name = '@dsh-external/dsh-vision-toolkit';
export { Config };
export const inject = ['tools', 'credentials', 'skills', 'subprocess', 'settings', 'agents', 'llm'];
/** Plugin entry: validate configuration synchronously, then mount asynchronously. */
export async function apply(ctx, config = {}) {
    // Registration itself rejects an invalid stored section before any runtime
    // or Tool becomes visible. The custom Web editor preflights runtime changes
    // before persistence; hand-edited settings still fail loud here or retain
    // the last serving generation when changed live.
    const settings = ctx.settings.register(VISION_TOOLKIT_SETTINGS_NAMESPACE, Config, {
        base: config,
        applies: 'live',
        validate: (value) => { resolveConfig(value); },
    });
    const manager = new VisionToolkitRuntimeManager(ctx);
    const artifacts = new ArtifactAccessController(await prepareArtifactAccessKey());
    const lifecycle = new AbortController();
    const disposers = [];
    let operationalDisposers;
    const ensureOperational = () => {
        if (!manager.ready || operationalDisposers !== undefined)
            return;
        const exposure = new VisionToolExposure(ctx, () => createVisionTools(() => manager.current(), value => artifacts.presentationMeta(value), lifecycle.signal));
        let activationTool;
        let exposureDisposer;
        let skill;
        try {
            activationTool = ctx.tools.register(exposure.activationTool);
            skill = ctx.skills.register(VISION_TOOLS_SKILL);
            exposureDisposer = exposure.install();
            operationalDisposers = { activationTool, exposure: exposureDisposer, skill };
            const info = manager.current().upstreamVersion;
            ctx.logger.info('dsh-vision-toolkit %s ready (upstream %s @ %s, checkout %s)', PLUGIN_VERSION, info.version, info.commit, info.path);
        }
        catch (error) {
            exposureDisposer?.();
            if (skill !== undefined)
                skill();
            activationTool?.();
            throw error;
        }
    };
    try {
        await manager.initialize(settings.get());
        ensureOperational();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.logger.error('dsh-vision-toolkit %s: runtime not ready; the vision-tools skill, activation bootstrap, and Agent-scoped visual tools are NOT registered. Settings remain available for repair. %s', PLUGIN_VERSION, message);
    }
    const backend = new VisionToolkitWebBackend(ctx, manager, artifacts, ensureOperational);
    installVisionToolkitWeb(ctx, backend, artifacts);
    // Pasted-image degradation (Web profiles only). The host asks plugins to
    // admit image content as text when the session model is text-only; we save
    // each pasted image into the session workspace and name the file in the
    // message, so the agent reads it through the visual tools (vision_glance &
    // co.) with a fully visible tool workflow — no hidden describe step. The
    // companion `llm/request-content` hook below strips image blocks from model
    // requests so a text-only adapter never serializes them. Native vision
    // models never reach either hook.
    ctx.on('prompt/image-fallback', async (payload, next) => {
        if (settings.get().degradePastedImages !== true)
            return next();
        try {
            const workspace = payload.agent.session.header.cwd;
            if (workspace === undefined) {
                ctx.logger.warn('dsh-vision-toolkit: pasted image degrade skipped; session has no project cwd');
                return next();
            }
            const degraded = await savePastedImages(payload.content, workspace, {
                stamp: () => new Date().toISOString().replace(/[:.]/gu, '-'),
            });
            return { content: degraded.content };
        }
        catch (error) {
            ctx.logger.warn('dsh-vision-toolkit: pasted image save failed; refusing the prompt: %s', error instanceof Error ? error.message : String(error));
            return next();
        }
    });
    // Strip image blocks from model requests only when the resolved target
    // model cannot accept images; the descriptions written by the degrade hook
    // (or the image blocks themselves on native models) pass through untouched.
    ctx.on('llm/request-content', async (payload, next) => {
        try {
            const info = await ctx.llm.resolveModelInfo(payload.options.provider, payload.options.model);
            if (info.inputModalities !== undefined && info.inputModalities.includes('image'))
                return next();
            if (!messagesContainImage(payload.options.messages))
                return next();
            const messages = stripImageBlocks(payload.options.messages);
            if (messages === undefined)
                return next();
            return { options: { ...payload.options, messages } };
        }
        catch (error) {
            ctx.logger.warn('dsh-vision-toolkit: llm/request-content modality check failed; forwarding unchanged: %s', error instanceof Error ? error.message : String(error));
            return next();
        }
    });
    disposers.push(settings.watch(async (next) => {
        try {
            await manager.reconfigure(next);
            ensureOperational();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger.error('dsh-vision-toolkit: keeping the previous runtime after a refused Settings generation. %s', message);
        }
    }));
    return () => {
        lifecycle.abort();
        if (operationalDisposers !== undefined) {
            operationalDisposers.exposure();
            operationalDisposers.activationTool();
            operationalDisposers.skill();
            operationalDisposers = undefined;
        }
        for (const dispose of disposers.reverse())
            dispose();
    };
}
//# sourceMappingURL=index.js.map