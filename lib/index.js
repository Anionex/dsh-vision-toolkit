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
import { Config, VISION_TOOLKIT_SETTINGS_NAMESPACE, resolveConfig, } from "./config.js";
import { VisionToolExposure } from "./exposure.js";
import { VisionToolkitRuntimeManager } from "./runtime-manager.js";
import { VISION_TOOLS_SKILL } from "./skill.js";
import { createVisionTools } from "./tools.js";
import { PLUGIN_VERSION } from "./version.js";
import { installVisionToolkitWeb, VisionToolkitWebBackend } from "./web.js";
export const name = '@dsh-external/dsh-vision-toolkit';
export { Config };
export const inject = ['tools', 'credentials', 'skills', 'subprocess', 'settings', 'agents'];
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