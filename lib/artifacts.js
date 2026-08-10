/**
 * Stable file-delivery descriptors owned by the plugin. DSH Core currently
 * has no reusable Artifact service, so every file-producing tool returns this
 * lossless contract and keeps the file inside the plugin-managed artifact
 * directory for Web, Headless, and later tool calls alike.
 * @module dsh-vision-toolkit/artifacts
 */
import { lstat, realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { VisionToolkitError } from "./errors.js";
import { isWithin } from "./paths.js";
/**
 * Validate and describe one committed regular file under the active artifact
 * root. Symbolic links are rejected even when their targets remain in-bounds,
 * so a later preview/download can never be redirected after delivery.
 * @param path - final managed artifact path.
 * @param policy - active workspace path policy.
 * @param description - stable type and presentation facts.
 * @returns a complete descriptor with the committed byte size.
 */
export async function describeArtifact(path, policy, description) {
    let linkInfo;
    try {
        linkInfo = await lstat(path);
    }
    catch (error) {
        throw new VisionToolkitError('output', `artifact was not created: ${basename(path)}`, { cause: error });
    }
    if (linkInfo.isSymbolicLink()) {
        throw new VisionToolkitError('path', `artifact must not be a symbolic link: ${basename(path)}`);
    }
    let real;
    try {
        real = await realpath(path);
    }
    catch (error) {
        throw new VisionToolkitError('output', `artifact is not accessible: ${basename(path)}`, { cause: error });
    }
    if (!isWithin(policy.outputDir, real)) {
        throw new VisionToolkitError('path', `artifact escaped the managed output directory: ${basename(path)}`);
    }
    const info = await stat(real);
    if (!info.isFile())
        throw new VisionToolkitError('output', `artifact is not a regular file: ${basename(path)}`);
    return {
        path,
        filename: basename(path),
        mimeType: description.mimeType,
        kind: description.kind,
        description: description.description,
        sourceTool: description.sourceTool,
        previewIntent: description.previewIntent,
        bytes: info.size,
    };
}
//# sourceMappingURL=artifacts.js.map