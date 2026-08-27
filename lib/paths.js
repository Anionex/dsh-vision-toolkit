/**
 * Path fence shared by every tool: inputs must live in the workspace, the
 * platform temporary directory, or an explicitly authorized directory;
 * outputs stay inside the plugin-managed output directory, and a symbolic
 * link is allowed only when its real target stays inside the fence.
 * @module dsh-vision-toolkit/paths
 */
import { createHash, randomUUID } from 'node:crypto';
import { cp, link, lstat, mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { homedir, tmpdir } from 'node:os';
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
/** Current platform temporary directory before realpath canonicalization. */
export function platformTempDirectory(platform = process.platform, environment = process.env) {
    if (platform !== 'win32')
        return '/tmp';
    const configured = environment.TEMP?.trim() || environment.TMP?.trim();
    return configured === undefined || configured.length === 0 ? tmpdir() : configured;
}
/**
 * Translate the POSIX-shaped `/tmp/...` paths commonly emitted by models to
 * the actual Windows temporary directory. Other paths and platforms are left
 * unchanged, and the normal realpath fence still validates the result.
 */
export function normalizePlatformTempPath(raw, platform = process.platform, tempDirectory = platformTempDirectory(platform)) {
    if (platform !== 'win32')
        return raw;
    if (raw === '/tmp')
        return tempDirectory;
    if (!raw.startsWith('/tmp/'))
        return raw;
    return win32.join(tempDirectory, raw.slice('/tmp/'.length));
}
/** Stable opaque workspace id used below a configured shared storage root. */
export function workspaceStorageId(workspace) {
    return createHash('sha256').update(workspace).digest('hex').slice(0, 20);
}
function assertSecureWorkspaceStorage(info, requested) {
    if (typeof process.geteuid !== 'function')
        return;
    if (info.uid !== process.geteuid() || (info.mode & 0o077) !== 0) {
        throw new VisionToolkitError('path', `workspace storage directory must be owned by the current user with mode 0700: ${requested}`);
    }
}
/** Resolve a shared base and prove every POSIX ancestor is protected from replacement. */
export async function assertSecureSharedStorageBase(requested) {
    const entry = await lstat(requested);
    if (entry.isSymbolicLink() && !(typeof process.geteuid === 'function' && entry.uid === 0)) {
        throw new VisionToolkitError('path', `configured storage directory must not be an untrusted symbolic link: ${requested}`);
    }
    const canonical = await realpath(requested);
    if (typeof process.geteuid !== 'function') {
        const info = await lstat(canonical);
        if (!info.isDirectory())
            throw new VisionToolkitError('path', `configured storage path is not a directory: ${requested}`);
        return canonical;
    }
    const currentUid = process.geteuid();
    let current = canonical;
    while (true) {
        const info = await lstat(current);
        const writableByOthers = (info.mode & 0o022) !== 0;
        const sticky = (info.mode & 0o1000) !== 0;
        if (info.isSymbolicLink()
            || !info.isDirectory()
            || (info.uid !== currentUid && info.uid !== 0)
            || (writableByOthers && !sticky))
            throw new VisionToolkitError('path', `configured storage directory has an untrusted path component: ${current}`);
        const parent = dirname(current);
        if (parent === current)
            return canonical;
        current = parent;
    }
}
async function managedDirectory(parent, requested, label, secureWorkspaceStorage = false) {
    try {
        await mkdir(requested, { mode: 0o700 });
    }
    catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
            throw new VisionToolkitError('path', `${label} is not writable: ${requested}`, { cause: error });
        }
    }
    let info;
    try {
        info = await lstat(requested);
    }
    catch (error) {
        throw new VisionToolkitError('path', `${label} is not accessible: ${requested}`, { cause: error });
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new VisionToolkitError('path', `${label} must be a real directory: ${requested}`);
    }
    if (secureWorkspaceStorage)
        assertSecureWorkspaceStorage(info, requested);
    const canonical = await realpath(requested);
    if (!isWithin(parent, canonical)) {
        throw new VisionToolkitError('path', `${label} escaped its configured root: ${requested}`);
    }
    return canonical;
}
/**
 * Resolve the plugin-managed root for one workspace. Blank configuration keeps
 * the legacy workspace-local `.dsh-vision-toolkit` directory. A configured
 * shared root receives one stable, automatically generated workspace child.
 */
export async function resolveWorkspaceStorage(workspaceRaw, storageDirRaw) {
    const expandedWorkspace = expandUserHome(workspaceRaw);
    const visibleWorkspace = resolve(expandedWorkspace);
    let workspace;
    try {
        workspace = await realpath(visibleWorkspace);
    }
    catch (error) {
        throw new VisionToolkitError('path', `workspace is not accessible: ${workspaceRaw}`, { cause: error });
    }
    if (storageDirRaw === undefined || storageDirRaw.trim().length === 0) {
        const visibleRoot = join(visibleWorkspace, '.dsh-vision-toolkit');
        const root = await managedDirectory(workspace, visibleRoot, 'plugin storage directory');
        return { workspace, root, visibleRoot };
    }
    const configured = normalizePlatformTempPath(expandUserHome(storageDirRaw.trim()));
    const requestedBase = isAbsolute(configured) ? configured : resolve(visibleWorkspace, configured);
    try {
        await mkdir(requestedBase, { recursive: true, mode: 0o700 });
    }
    catch (error) {
        throw new VisionToolkitError('path', `configured storage directory is not writable: ${requestedBase}`, { cause: error });
    }
    let base;
    try {
        base = await assertSecureSharedStorageBase(requestedBase);
    }
    catch (error) {
        throw new VisionToolkitError('path', `configured storage directory is not accessible: ${requestedBase}`, { cause: error });
    }
    const id = workspaceStorageId(workspace);
    const visibleRoot = join(requestedBase, id);
    const root = await managedDirectory(base, join(base, id), 'workspace storage directory', true);
    return { workspace, root, visibleRoot };
}
/**
 * Build the per-invocation path policy: resolve workspace storage, realpath the
 * platform temp directory and allowed directories, and create the artifact
 * directory inside the managed root.
 * @param workspaceRaw - session workspace (or process cwd fallback).
 * @param allowedDirs - configured extra allowed roots.
 * @param storageDirRaw - optional shared storage root.
 * @returns the resolved policy.
 */
export async function createPathPolicy(workspaceRaw, allowedDirs, storageDirRaw) {
    const storage = await resolveWorkspaceStorage(workspaceRaw, storageDirRaw);
    const { workspace } = storage;
    let tempDir;
    const tempDirectoryRaw = platformTempDirectory();
    try {
        tempDir = await realpath(tempDirectoryRaw);
    }
    catch (error) {
        throw new VisionToolkitError('path', `platform temporary directory is not accessible: ${tempDirectoryRaw}`, { cause: error });
    }
    const roots = [workspace, tempDir, storage.root];
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
    const outputDir = await managedDirectory(storage.root, join(storage.root, 'artifacts'), 'artifact directory');
    return {
        workspace,
        tempDir,
        allowedDirs: [...new Set(roots)],
        storageRoot: storage.root,
        outputDir,
    };
}
/**
 * Validate one input image path and return its fence-checked absolute path
 * and byte size.
 * @param raw - image path, resolved against the workspace.
 * @param policy - active path fence.
 * @returns absolute path and file size.
 */
export async function resolveInputFile(raw, policy) {
    return resolveAuthorizedFile(raw, policy, SUPPORTED_IMAGE_EXTENSIONS, 'image');
}
/**
 * Validate one authorized regular file against an explicit extension set.
 * Realpath fencing makes local HTML and future non-image inputs follow the
 * same symlink-safe policy as images.
 * @param raw - path resolved against the workspace.
 * @param policy - active path fence.
 * @param extensions - accepted lowercase extensions including the leading dot.
 * @param kind - user-facing noun used in stable errors.
 * @returns absolute real path and file size.
 */
export async function resolveAuthorizedFile(raw, policy, extensions, kind) {
    const candidate = expandUserHome(normalizePlatformTempPath(raw, process.platform, policy.tempDir));
    const target = isAbsolute(candidate) ? candidate : resolve(policy.workspace, candidate);
    let real;
    try {
        real = await realpath(target);
    }
    catch (error) {
        throw new VisionToolkitError('input', `${kind} not found: ${raw}`, { cause: error });
    }
    if (!policy.allowedDirs.some(root => isWithin(root, real))) {
        throw new VisionToolkitError('path', `${kind} escapes the allowed directories: ${raw}`);
    }
    let info;
    try {
        info = await stat(real);
    }
    catch (error) {
        throw new VisionToolkitError('input', `${kind} is not readable: ${raw}`, { cause: error });
    }
    if (!info.isFile())
        throw new VisionToolkitError('input', `${kind} is not a regular file: ${raw}`);
    const extension = real.slice(real.lastIndexOf('.')).toLowerCase();
    if (!extensions.includes(extension)) {
        throw new VisionToolkitError('input', `unsupported ${kind} format "${extension || '(none)'}"; supported: ${extensions.join(', ')}`);
    }
    return { path: real, bytes: info.size };
}
/** Validate a local HTML document; URL and data-URI inputs never reach Chrome. */
export function resolveHtmlFile(raw, policy) {
    return resolveAuthorizedFile(raw, policy, ['.html', '.htm'], 'HTML source');
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
    if (segments.length !== 1 || segments[0] === '' || segments[0] === '.' || segments[0] === '..') {
        throw new VisionToolkitError('path', 'output must be one filename inside the output directory');
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
/**
 * Reserve a random, non-user-controlled staging path inside the real output
 * directory. Upstream writes here so an existing destination symlink can
 * never redirect the write outside the fence.
 * @param policy - active path fence.
 * @param extension - output extension including the leading dot.
 * @returns absent staging path inside {@link PathPolicy.outputDir}.
 */
export function createStagedOutput(policy, extension) {
    if (extension !== extname(`file${extension}`) || !/^\.[a-z0-9]+$/i.test(extension)) {
        throw new VisionToolkitError('output', `invalid staging extension: ${extension}`);
    }
    return join(policy.outputDir, `.vision-toolkit-${randomUUID()}${extension}`);
}
/** Resolve one direct child directory of the managed artifact root. */
export function resolveOutputDirectory(raw, policy, defaultName) {
    const name = raw === undefined || raw.trim().length === 0 ? defaultName : raw.trim();
    const expanded = expandUserHome(name);
    if (isAbsolute(expanded))
        throw new VisionToolkitError('path', 'artifact directory must not be an absolute path');
    const segments = expanded.split(/[\\/]/);
    if (segments.length !== 1
        || segments[0] === ''
        || segments[0] === '.'
        || segments[0] === '..'
        || expanded.startsWith('.vision-toolkit-')) {
        throw new VisionToolkitError('path', 'artifact directory must be one visible directory name inside the output directory');
    }
    const target = resolve(policy.outputDir, expanded);
    if (!isWithin(policy.outputDir, target)) {
        throw new VisionToolkitError('path', 'artifact directory must stay inside the output directory');
    }
    return target;
}
/** Create a random staging directory that no upstream command can choose. */
export async function createStagedDirectory(policy) {
    const path = join(policy.outputDir, `.vision-toolkit-${randomUUID()}`);
    await mkdir(path);
    return path;
}
async function assertSafeDirectoryTree(root, current = root) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
            throw new VisionToolkitError('path', `managed artifact directory contains a symbolic link: ${entry.name}`);
        }
        if (info.isDirectory()) {
            await assertSafeDirectoryTree(root, path);
            continue;
        }
        if (!info.isFile()) {
            throw new VisionToolkitError('path', `managed artifact directory contains a non-regular entry: ${entry.name}`);
        }
        const real = await realpath(path);
        if (!isWithin(root, real)) {
            throw new VisionToolkitError('path', `managed artifact entry escaped its directory: ${entry.name}`);
        }
    }
}
/**
 * Copy an existing managed run into staging for an explicit resume operation.
 * A missing destination is a normal first run; non-directory or symlink state
 * fails closed instead of giving the upstream script an ambiguous workspace.
 */
export async function seedStagedDirectory(finalPath, staged, policy) {
    let info;
    try {
        info = await lstat(finalPath);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        throw new VisionToolkitError('path', 'existing artifact directory is not accessible', { cause: error });
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new VisionToolkitError('path', 'resume target must be a real managed artifact directory');
    }
    const real = await realpath(finalPath);
    if (!isWithin(policy.outputDir, real)) {
        throw new VisionToolkitError('path', 'resume target escaped the managed output directory');
    }
    await assertSafeDirectoryTree(real);
    await cp(real, staged, { recursive: true, force: true });
    await assertSafeDirectoryTree(staged);
    return true;
}
/**
 * Atomically replace one managed artifact directory, restoring the previous
 * complete run if the final rename fails. The upstream only ever writes the
 * random staging path.
 */
export async function commitStagedDirectory(staged, finalPath, policy) {
    const stagedReal = await realpath(staged).catch((error) => {
        throw new VisionToolkitError('output', 'upstream did not create the expected artifact directory', { cause: error });
    });
    if (!isWithin(policy.outputDir, stagedReal)) {
        throw new VisionToolkitError('path', 'staged artifact directory escaped the managed output directory');
    }
    const stagedInfo = await lstat(stagedReal);
    if (stagedInfo.isSymbolicLink() || !stagedInfo.isDirectory()) {
        throw new VisionToolkitError('output', 'staged artifact output is not a real directory');
    }
    await assertSafeDirectoryTree(stagedReal);
    const backup = join(policy.outputDir, `.vision-toolkit-backup-${randomUUID()}`);
    let movedPrevious = false;
    try {
        try {
            await rename(finalPath, backup);
            movedPrevious = true;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        try {
            await rename(stagedReal, finalPath);
        }
        catch (error) {
            if (movedPrevious)
                await rename(backup, finalPath).catch(() => { });
            throw error;
        }
        if (movedPrevious)
            await rm(backup, { recursive: true, force: true });
    }
    catch (error) {
        throw new VisionToolkitError('output', 'could not commit the managed artifact directory', { cause: error });
    }
}
/**
 * Validate a staged regular file and atomically place it at the resolved final
 * filename. Replacing an existing symlink replaces the link itself; upstream
 * never opens the user-selected destination.
 * @param staged - random staging path returned by {@link createStagedOutput}.
 * @param finalPath - final path returned by {@link resolveOutputFile}.
 * @param policy - active path fence.
 */
export async function commitStagedOutput(staged, finalPath, policy) {
    const real = await realpath(staged).catch((error) => {
        throw new VisionToolkitError('output', 'upstream did not create the expected output file', { cause: error });
    });
    if (!isWithin(policy.outputDir, real)) {
        throw new VisionToolkitError('path', 'staged output escaped the managed output directory');
    }
    const info = await stat(real);
    if (!info.isFile())
        throw new VisionToolkitError('output', 'upstream output is not a regular file');
    try {
        await rename(real, finalPath);
    }
    catch (error) {
        const code = error.code;
        if (code !== 'EEXIST' && code !== 'EPERM')
            throw error;
        await rm(finalPath, { force: true });
        try {
            await link(real, finalPath);
        }
        catch (linkError) {
            if (linkError.code === 'EEXIST') {
                throw new VisionToolkitError('path', 'output destination changed while the staged file was being committed', { cause: linkError });
            }
            throw linkError;
        }
        await rm(real, { force: true });
    }
}
/** Reject an output that would overwrite its own input file. */
export function assertDistinctOutput(input, output) {
    if (input === output) {
        throw new VisionToolkitError('input', 'output would overwrite the input image');
    }
}
//# sourceMappingURL=paths.js.map