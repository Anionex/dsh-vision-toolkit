/**
 * Stable error vocabulary shared by the runtime, upstream adapter, and tools.
 * Every failure reaching the model carries one of these codes and a message
 * that never contains credentials or raw upstream stack traces.
 * @module dsh-vision-toolkit/errors
 */
/** Discriminant tag for every Vision Toolkit failure. */
export declare const VISION_TOOLKIT_ERROR_CODES: readonly ["config", "input", "capacity", "service", "runtime", "output", "cancelled", "path"];
/** Stable machine-readable error category. */
export type VisionToolkitErrorCode = typeof VISION_TOOLKIT_ERROR_CODES[number];
/** Error with a stable category; safe to surface to the model. */
export declare class VisionToolkitError extends Error {
    readonly code: VisionToolkitErrorCode;
    constructor(code: VisionToolkitErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
/**
 * Replace every known secret occurrence in untrusted text. Used before
 * upstream stderr, exit messages, or trace reports enter logs or results.
 * @param text - text that may embed a secret.
 * @param secrets - values that must never be surfaced.
 * @returns text with each secret replaced by a fixed marker.
 */
export declare function redactText(text: string, secrets: readonly string[]): string;
/**
 * Build a model-safe upstream failure line: the tool prefix plus the
 * redacted stderr tail, never a JavaScript stack.
 * @param tool - upstream CLI name.
 * @param stderr - captured upstream stderr.
 * @param secrets - values to redact.
 * @returns one-line safe message.
 */
export declare function upstreamFailureMessage(tool: string, stderr: string, secrets: readonly string[]): string;
//# sourceMappingURL=errors.d.ts.map