/**
 * @dsh-external/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Plugin lifecycle follows the documented readiness chain: verify the pinned
 * upstream checkout (runtime dependencies) → register the native tools →
 * mount the vision-tools skill. Any failure leaves no tools and no skill
 * behind, and disposal unregisters everything the plugin mounted.
 * @module @dsh-external/dsh-vision-toolkit
 */
import { ArtifactAccessController, prepareArtifactAccessKey } from "./artifact-access.js";
import { Config, VISION_TOOLKIT_SETTINGS_NAMESPACE, resolveConfig, } from "./config.js";
import { VisionToolkitRuntimeManager } from "./runtime-manager.js";
import { VISION_TOOLS_SKILL } from "./skill.js";
import { createVisionTools } from "./tools.js";
import { PLUGIN_VERSION } from "./version.js";
import { installVisionToolkitWeb, VisionToolkitWebBackend } from "./web.js";
export const name = '@dsh-external/dsh-vision-toolkit';
export { Config };
export const inject = ['tools', 'credentials', 'skills', 'subprocess', 'settings'];
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
    const disposers = [];
    let operationalDisposers;
    const ensureOperational = () => {
        if (!manager.ready || operationalDisposers !== undefined)
            return;
        const mounted = [];
        try {
            for (const tool of createVisionTools(() => manager.current(), value => artifacts.presentationMeta(value))) {
                mounted.push(ctx.tools.register(tool));
            }
            mounted.push(ctx.skills.register(VISION_TOOLS_SKILL));
            operationalDisposers = mounted;
            const info = manager.current().upstreamVersion;
            ctx.logger.info('dsh-vision-toolkit %s ready (upstream %s @ %s, checkout %s)', PLUGIN_VERSION, info.version, info.commit, info.path);
        }
        catch (error) {
            for (const dispose of mounted.reverse())
                dispose();
            throw error;
        }
    };
    try {
        await manager.initialize(settings.get());
        ensureOperational();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.logger.error('dsh-vision-toolkit %s: runtime not ready; vision tools and the vision-tools skill are NOT registered. Settings remain available for repair. %s', PLUGIN_VERSION, message);
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
        if (operationalDisposers !== undefined) {
            for (const dispose of operationalDisposers.reverse())
                dispose();
            operationalDisposers = undefined;
        }
        for (const dispose of disposers.reverse())
            dispose();
    };
}
//# sourceMappingURL=index.js.map