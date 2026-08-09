/**
 * Path fence shared by every tool: inputs must live in the workspace or an
 * explicitly authorized directory, outputs stay inside the plugin-managed
 * output directory, and a symbolic link is allowed only when its real target
 * stays inside the fence.
 * @module dsh-vision-toolkit/paths
 */
import { mkdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { VisionToolkitError } from "./errors.js";
/** Supported input image extensions (the upstream client's allowlist). */
export const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
/** Whether `child` equals or lies under `parent` on the same path root. */
export function isWithin(parent, child) {
    const rel = relative(parent, child);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function expandUserHome(raw) {
    if (raw === '~')
        return homedir();
    if (raw.startsWith('~/') || raw.startsWith(`~${sep}`))
        return join(homedir(), raw.slice(2));
    return raw;
}
/**
 * Build the per-invocation path policy: realpath the workspace, resolve and
 * realpath allowed directories, and create the output directory inside the
 * fence.
 * @param workspaceRaw - session workspace (or process cwd fallback).
 * @param allowedDirs - configured extra allowed roots.
 * @param outputDirRaw - configured output directory (default `.dsh-vision-toolkit`).
 * @returns the resolved policy.
 */
export async function createPathPolicy(workspaceRaw, allowedDirs, outputDirRaw) {
    let workspace;
    try {
        workspace = await realpath(expandUserHome(workspaceRaw));
    }
    catch (error) {
        throw new VisionToolkitError('path', `workspace is not accessible: ${workspaceRaw}`, { cause: error });
    }
    const roots = [workspace];
    for (const raw of allowedDirs) {
        const candidate = expandUserHome(raw);
        const target = isAbsolute(candidate) ? candidate : resolve(workspace, candidate);
        try {
            roots.push(await realpath(target));
        }
        catch (error) {
            throw new VisionToolkitError('path', `allowedDirs entry is not accessible: ${raw}`, { cause: error });
        }
    }
    const outputRaw = outputDirRaw === undefined || outputDirRaw.trim().length === 0
        ? join(workspace, '.dsh-vision-toolkit')
        : resolve(workspace, expandUserHome(outputDirRaw));
    if (!roots.some(root => isWithin(root, outputRaw))) {
        throw new VisionToolkitError('path', 'output directory must stay inside the workspace or an allowedDirs entry');
    }
    let outputDir;
    try {
        await mkdir(outputRaw, { recursive: true });
        outputDir = await realpath(outputRaw);
    }
    catch (error) {
        throw new VisionToolkitError('path', `output directory is not writable: ${outputRaw}`, { cause: error });
    }
    return { workspace, allowedDirs: roots, outputDir };
}
/**
 * Validate one input image path and return its fence-checked absolute path
 * and byte size.
 * @param raw - image path, resolved against the workspace.
 * @param policy - active path fence.
 * @returns absolute path and file size.
 */
export async function resolveInputFile(raw, policy) {
    const candidate = expandUserHome(raw);
    const target = isAbsolute(candidate) ? candidate : resolve(policy.workspace, candidate);
    let real;
    try {
        real = await realpath(target);
    }
    catch (error) {
        throw new VisionToolkitError('input', `image not found: ${raw}`, { cause: error });
    }
    if (!policy.allowedDirs.some(root => isWithin(root, real))) {
        throw new VisionToolkitError('path', `image escapes the allowed directories: ${raw}`);
    }
    let info;
    try {
        info = await stat(real);
    }
    catch (error) {
        throw new VisionToolkitError('input', `image is not readable: ${raw}`, { cause: error });
    }
    if (info.isDirectory())
        throw new VisionToolkitError('input', `image path is a directory: ${raw}`);
    const extension = real.slice(real.lastIndexOf('.')).toLowerCase();
    if (!SUPPORTED_IMAGE_EXTENSIONS.includes(extension)) {
        throw new VisionToolkitError('input', `unsupported image format "${extension || '(none)'}"; supported: ${SUPPORTED_IMAGE_EXTENSIONS.join(', ')}`);
    }
    return { path: real, bytes: info.size };
}
/**
 * Resolve an optional user-supplied output filename inside the plugin output
 * directory. Absolute paths, `..` segments, and wrong extensions are rejected.
 * @param raw - output filename (workspace/outputDir-relative).
 * @param policy - active path fence.
 * @param defaultName - generated default filename.
 * @param extensions - allowed extensions for this output kind.
 * @returns absolute output path (not yet created).
 */
export function resolveOutputFile(raw, policy, defaultName, extensions) {
    const name = raw === undefined || raw.trim().length === 0 ? defaultName : raw.trim();
    const expanded = expandUserHome(name);
    if (isAbsolute(expanded))
        throw new VisionToolkitError('path', 'output must be a filename, not an absolute path');
    const segments = expanded.split(/[\\/]/);
    if (segments.some(segment => segment === '..' || segment === '')) {
        throw new VisionToolkitError('path', 'output must stay inside the output directory');
    }
    const extension = expanded.slice(expanded.lastIndexOf('.')).toLowerCase();
    if (!extensions.includes(extension)) {
        throw new VisionToolkitError('output', `output must use one of: ${extensions.join(', ')}`);
    }
    const target = resolve(policy.outputDir, expanded);
    if (!isWithin(policy.outputDir, target)) {
        throw new VisionToolkitError('path', 'output must stay inside the output directory');
    }
    return target;
}
/** Reject an output that would overwrite its own input file. */
export function assertDistinctOutput(input, output) {
    if (input === output) {
        throw new VisionToolkitError('input', 'output would overwrite the input image');
    }
}
//# sourceMappingURL=paths.js.map