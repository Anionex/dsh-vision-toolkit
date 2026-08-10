/**
 * Path fence shared by every tool: inputs must live in the workspace or an
 * explicitly authorized directory, outputs stay inside the plugin-managed
 * output directory, and a symbolic link is allowed only when its real target
 * stays inside the fence.
 * @module dsh-vision-toolkit/paths
 */
/** Supported input image extensions (the upstream client's allowlist). */
export declare const SUPPORTED_IMAGE_EXTENSIONS: readonly [".png", ".jpg", ".jpeg", ".gif", ".webp"];
/** Resolved path policy for one tool invocation. */
export interface PathPolicy {
    /** Real workspace root. */
    workspace: string;
    /** Real allowed roots: workspace plus configured extra directories. */
    allowedDirs: string[];
    /** Real plugin-managed output directory inside the fence. */
    outputDir: string;
}
/** Whether `child` equals or lies under `parent` on the same path root. */
export declare function isWithin(parent: string, child: string): boolean;
/**
 * Build the per-invocation path policy: realpath the workspace, resolve and
 * realpath allowed directories, and create the output directory inside the
 * fence.
 * @param workspaceRaw - session workspace (or process cwd fallback).
 * @param allowedDirs - configured extra allowed roots.
   * @param outputDirRaw - configured output directory (default `.dsh-vision-toolkit/artifacts`).
 * @returns the resolved policy.
 */
export declare function createPathPolicy(workspaceRaw: string, allowedDirs: readonly string[], outputDirRaw?: string): Promise<PathPolicy>;
/**
 * Validate one input image path and return its fence-checked absolute path
 * and byte size.
 * @param raw - image path, resolved against the workspace.
 * @param policy - active path fence.
 * @returns absolute path and file size.
 */
export declare function resolveInputFile(raw: string, policy: PathPolicy): Promise<{
    path: string;
    bytes: number;
}>;
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
export declare function resolveAuthorizedFile(raw: string, policy: PathPolicy, extensions: readonly string[], kind: string): Promise<{
    path: string;
    bytes: number;
}>;
/** Validate a local HTML document; URL and data-URI inputs never reach Chrome. */
export declare function resolveHtmlFile(raw: string, policy: PathPolicy): Promise<{
    path: string;
    bytes: number;
}>;
/**
 * Resolve an optional user-supplied output filename inside the plugin output
 * directory. Absolute paths, `..` segments, and wrong extensions are rejected.
 * @param raw - output filename (workspace/outputDir-relative).
 * @param policy - active path fence.
 * @param defaultName - generated default filename.
 * @param extensions - allowed extensions for this output kind.
 * @returns absolute output path (not yet created).
 */
export declare function resolveOutputFile(raw: string | undefined, policy: PathPolicy, defaultName: string, extensions: readonly string[]): string;
/**
 * Reserve a random, non-user-controlled staging path inside the real output
 * directory. Upstream writes here so an existing destination symlink can
 * never redirect the write outside the fence.
 * @param policy - active path fence.
 * @param extension - output extension including the leading dot.
 * @returns absent staging path inside {@link PathPolicy.outputDir}.
 */
export declare function createStagedOutput(policy: PathPolicy, extension: string): string;
/** Resolve one direct child directory of the managed artifact root. */
export declare function resolveOutputDirectory(raw: string | undefined, policy: PathPolicy, defaultName: string): string;
/** Create a random staging directory that no upstream command can choose. */
export declare function createStagedDirectory(policy: PathPolicy): Promise<string>;
/**
 * Copy an existing managed run into staging for an explicit resume operation.
 * A missing destination is a normal first run; non-directory or symlink state
 * fails closed instead of giving the upstream script an ambiguous workspace.
 */
export declare function seedStagedDirectory(finalPath: string, staged: string, policy: PathPolicy): Promise<boolean>;
/**
 * Atomically replace one managed artifact directory, restoring the previous
 * complete run if the final rename fails. The upstream only ever writes the
 * random staging path.
 */
export declare function commitStagedDirectory(staged: string, finalPath: string, policy: PathPolicy): Promise<void>;
/**
 * Validate a staged regular file and atomically place it at the resolved final
 * filename. Replacing an existing symlink replaces the link itself; upstream
 * never opens the user-selected destination.
 * @param staged - random staging path returned by {@link createStagedOutput}.
 * @param finalPath - final path returned by {@link resolveOutputFile}.
 * @param policy - active path fence.
 */
export declare function commitStagedOutput(staged: string, finalPath: string, policy: PathPolicy): Promise<void>;
/** Reject an output that would overwrite its own input file. */
export declare function assertDistinctOutput(input: string, output: string): void;
//# sourceMappingURL=paths.d.ts.map