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
 * @param outputDirRaw - configured output directory (default `.dsh-vision-toolkit`).
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
 * Resolve an optional user-supplied output filename inside the plugin output
 * directory. Absolute paths, `..` segments, and wrong extensions are rejected.
 * @param raw - output filename (workspace/outputDir-relative).
 * @param policy - active path fence.
 * @param defaultName - generated default filename.
 * @param extensions - allowed extensions for this output kind.
 * @returns absolute output path (not yet created).
 */
export declare function resolveOutputFile(raw: string | undefined, policy: PathPolicy, defaultName: string, extensions: readonly string[]): string;
/** Reject an output that would overwrite its own input file. */
export declare function assertDistinctOutput(input: string, output: string): void;
//# sourceMappingURL=paths.d.ts.map