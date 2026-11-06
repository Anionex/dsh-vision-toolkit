/**
 * @anionex/dsh-vision-toolkit — DSH Vision Toolkit profile bundle.
 *
 * Verify bundled assets and publish the Skill/bootstrap before preparing the
 * runtime in the background. Skill-scoped calls wait for readiness and report
 * preparation failures; disposal cancels preparation and removes contributions.
 * @module @anionex/dsh-vision-toolkit
 */
import { ArtifactAccessController, prepareArtifactAccessKey } from "./artifact-access.js";
import { prepareWatchedSettingsGeneration, plainVisionConfig, resolveConfig, } from "./config.js";
import { VisionToolExposure } from "./exposure.js";
import { createPasteTakeoverResolver, installImageInputVariants } from "./image-input-variants.js";
import { VisionToolkitRuntimeManager } from "./runtime-manager.js";
import { verifyBundledUpstream } from "./runtime-install.js";
import { VISION_SKILLS_SKILL } from "./skill.js";
import { StorageHistoryStore } from "./storage-history.js";
import { bindVisionSettings } from "./settings-compat.js";
import { createVisionTools } from "./tools.js";
import { PLUGIN_VERSION } from "./version.js";
import { installVisionToolkitWeb, VisionToolkitWebBackend } from "./web.js";
import { MAX_PASTE_IMAGE_BYTES, PastedImageBackend } from "./paste-images.js";
export const name = '@anionex/dsh-vision-toolkit';
export { Config } from "./config.js";
export const inject = ['tools', 'skills', 'subprocess', 'settings', 'agents', 'sessions'];
/** Plugin entry: validate configuration synchronously, then mount asynchronously. */
export async function apply(ctx, config = {}) {
    // Registration itself rejects an invalid stored section before any runtime
    // or Tool becomes visible. The custom Web editor preflights runtime changes
    // before persistence; hand-edited settings still fail loud here or retain
    // the last serving generation when changed live.
    const settings = bindVisionSettings(ctx, plainVisionConfig(config));
    const manager = new VisionToolkitRuntimeManager(ctx);
    const artifacts = new ArtifactAccessController(await prepareArtifactAccessKey());
    const lifecycle = new AbortController();
    const disposers = [];
    const storageHistory = new StorageHistoryStore(ctx);
    disposers.push(() => { storageHistory.dispose(); });
    let storageHistoryWarningReported = false;
    let operationalDisposers;
    const persistStorageHistory = async (candidate, required) => {
        try {
            const persisted = await storageHistory.persist(candidate);
            if (persisted)
                return;
            const error = new Error('configured storage history requires @deepseek-ai/dsh-storage-domain when Settings cannot persist it');
            if (required)
                throw error;
            if (!storageHistoryWarningReported) {
                storageHistoryWarningReported = true;
                ctx.logger.warn('dsh-vision-toolkit: %s', error.message);
            }
        }
        catch (error) {
            if (required)
                throw error;
            if (!storageHistoryWarningReported) {
                storageHistoryWarningReported = true;
                const message = error instanceof Error ? error.message : String(error);
                ctx.logger.warn('dsh-vision-toolkit: configured storage history was not persisted. %s', message);
            }
        }
    };
    const ensureOperational = () => {
        if (lifecycle.signal.aborted || operationalDisposers !== undefined)
            return;
        const exposure = new VisionToolExposure(ctx, () => createVisionTools(signal => manager.whenReady(signal), value => artifacts.presentationMeta(value), lifecycle.signal));
        let activationTool;
        let exposureDisposer;
        let skill;
        try {
            activationTool = ctx.tools.register(exposure.activationTool);
            skill = ctx.skills.register(VISION_SKILLS_SKILL);
            exposureDisposer = exposure.install();
            operationalDisposers = { activationTool, exposure: exposureDisposer, skill };
        }
        catch (error) {
            exposureDisposer?.();
            if (skill !== undefined)
                skill();
            activationTool?.();
            throw error;
        }
    };
    const initialConfig = await storageHistory.restore(settings.get());
    // Verify the shipped Skill/tool implementation before discovery. Interpreter
    // probing, downloads and installation are cancellable background work.
    await verifyBundledUpstream();
    const preparation = manager.start(initialConfig, candidate => persistStorageHistory(candidate.config, false));
    ensureOperational();
    void preparation.then(() => {
        if (lifecycle.signal.aborted)
            return;
        ensureOperational();
        variants.reconcile();
    }).catch(async (error) => {
        if (lifecycle.signal.aborted || manager.ready)
            return;
        const resolvedInitial = resolveConfig(initialConfig);
        if (resolvedInitial.storageDir === undefined
            || manager.validatedStorageDirectory() === resolvedInitial.storageDir) {
            await persistStorageHistory(initialConfig, false);
        }
        const message = error instanceof Error ? error.message : String(error);
        ctx.logger.error('dsh-vision-toolkit %s: runtime preparation failed; visual calls report this failure. Settings remain available for repair. %s', PLUGIN_VERSION, message);
    });
    const backend = new VisionToolkitWebBackend(ctx, manager, artifacts, ensureOperational);
    const currentConfig = () => manager.ready
        ? manager.currentConfig()
        : resolveConfig(settings.get());
    const pastedImages = new PastedImageBackend(ctx, {
        maxUploadBytes: () => MAX_PASTE_IMAGE_BYTES,
        storageGeneration: () => manager.storageGeneration(),
    });
    // Image-input variants register asynchronously once eligible routes exist;
    // the runtime getter stays lazy so variants appear even when the runtime
    // becomes ready after the first sweep.
    const variants = installImageInputVariants(ctx, currentConfig, () => manager.ready ? manager.current() : undefined, () => manager.validatedStorageDirectory());
    installVisionToolkitWeb(ctx, backend, artifacts, pastedImages, createPasteTakeoverResolver(ctx, currentConfig), () => ({ hidden: currentConfig().imageInputVariants.hidden }));
    disposers.push(variants.dispose);
    disposers.push(settings.watch(async (next, previous) => {
        try {
            const prepared = await prepareWatchedSettingsGeneration(next, previous, ctx.settings.writable, storageHistory => settings.update({ storageHistory }));
            if (prepared.persistenceError !== undefined) {
                const message = prepared.persistenceError instanceof Error
                    ? prepared.persistenceError.message
                    : String(prepared.persistenceError);
                ctx.logger.warn('dsh-vision-toolkit: activating Settings without persisting internal storage history. %s', message);
            }
            if (prepared.config === undefined)
                return;
            const candidate = await storageHistory.restore(prepared.config);
            await manager.reconfigure(candidate, generation => persistStorageHistory(generation.config, prepared.requiresDurableStorageHistory === true));
            ensureOperational();
            variants.reconcile();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger.error('dsh-vision-toolkit: keeping the previous runtime after a refused Settings generation. %s', message);
        }
    }));
    return () => {
        lifecycle.abort();
        manager.dispose();
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