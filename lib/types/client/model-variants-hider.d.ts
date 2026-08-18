/**
 * Transparent routing for the host model selector: when `imageInputVariants.hidden`
 * is enabled, variant routes keep the upstream provider/model display names and
 * the browser hides the upstream text-only entries that have a variant twin.
 * Users then see one entry per model — the original name — while the session
 * actually runs on the image-capable variant, so pasted images, history with
 * images, and the built-in `read_image` tool all keep working on text-only
 * models without exposing `(Vision Toolkit)` routes.
 *
 * The host selector renders one `[role=group]` per provider whose group title
 * id is `:<react-radix>:-<providerId>`, and one `[role=menuitemradio]` per
 * model. We key groups by that provider id (variant routes carry the
 * `vision-toolkit-` prefix) and hide every upstream entry whose display name
 * matches a variant twin, collapsing fully-hidden upstream groups.
 * @module dsh-vision-toolkit/model-variants-hider
 */
/**
 * Hide upstream text-only entries that have a variant twin. Group keys come
 * from `aria-labelledby` ids so provider identity is reliable even when the
 * variant provider name equals the upstream name (transparent mode).
 */
export declare function tidyModelSelector(): void;
/**
 * Install the transparent-routing integrator. It watches the document for
 * model-selector renderings and re-tidies them whenever the host re-renders.
 * @returns the disposer that stops observation and restores hidden entries.
 */
export declare function installModelVariantsHider(): () => void;
/** Test seam: expose whether the integrator currently considers routing active. */
export declare function isModelVariantsHiderActive(): boolean;
//# sourceMappingURL=model-variants-hider.d.ts.map