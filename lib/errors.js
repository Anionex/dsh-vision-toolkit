/**
 * Stable error vocabulary shared by the runtime, upstream adapter, and tools.
 * Every failure reaching the model carries one of these codes and a message
 * that never contains credentials or raw upstream stack traces.
 * @module dsh-vision-toolkit/errors
 */
/** Discriminant tag for every Vision Toolkit failure. */
export const VISION_TOOLKIT_ERROR_CODES = [
    'config',
    'input',
    'capacity',
    'service',
    'runtime',
    'output',
    'timeout',
    'cancelled',
    'path',
];
/** Error with a stable category; safe to surface to the model. */
export class VisionToolkitError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'VisionToolkitError';
        this.code = code;
    }
}
/**
 * Replace every known secret occurrence in untrusted text. Used before
 * upstream stderr, exit messages, or trace reports enter logs or results.
 * @param text - text that may embed a secret.
 * @param secrets - values that must never be surfaced.
 * @returns text with each secret replaced by a fixed marker.
 */
export function redactText(text, secrets) {
    let result = text;
    for (const secret of secrets) {
        if (secret.length === 0)
            continue;
        result = result.split(secret).join('<redacted>');
    }
    return result;
}
/**
 * Build a model-safe upstream failure line: the tool prefix plus the
 * redacted stderr tail, never a JavaScript stack.
 * @param tool - upstream CLI name.
 * @param stderr - captured upstream stderr.
 * @param secrets - values to redact.
 * @returns one-line safe message.
 */
export function upstreamFailureMessage(tool, stderr, secrets) {
    const tail = redactText(stderr, secrets).trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ');
    return tail.length === 0 ? `${tool}: upstream command failed` : `${tool}: ${tail}`;
}
//# sourceMappingURL=errors.js.map