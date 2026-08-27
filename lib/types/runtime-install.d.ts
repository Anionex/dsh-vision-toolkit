/**
 * Reproducible upstream runtime preparation. Managed mode uses the packaged,
 * hash-verified agent-vision-toolkit snapshot plus an atomic isolated Python
 * environment; external mode accepts only the pinned clean Git commit or an
 * exact exported copy of the packaged snapshot.
 * @module dsh-vision-toolkit/runtime-install
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedVisionToolkitConfig } from './config.ts';
/** One executable plus fixed prefix arguments (for example Windows `py -3`). */
export interface RuntimeCommand {
    program: string;
    prefix: string[];
    display: string;
}
/** Prepared source and interpreter facts consumed by the upstream adapter. */
export interface PreparedUpstreamRuntime {
    source: 'managed' | 'external';
    root: string;
    python: RuntimeCommand;
    cleanHome: string;
    pythonVersion: string;
    dependencies: Record<string, string>;
}
interface UpstreamManifest {
    schemaVersion: number;
    repository: string;
    version: string;
    commit: string;
    contentSha256: string;
    files: Array<{
        path: string;
        bytes: number;
        sha256: string;
    }>;
}
/** Absolute root of the packaged upstream snapshot. */
export declare function bundledUpstreamRoot(): string;
/** Convert one command into a user-facing executable string. */
export declare function displayCommand(command: RuntimeCommand): string;
/**
 * Windows Defender/antivirus real-time scanning briefly locks freshly written
 * Python DLLs, so recursive removal and directory replacement can fail with
 * EBUSY/EPERM immediately after installation. Retry those transient Windows
 * errors before surfacing them; non-Windows platforms pass through unchanged.
 */
export declare function withWindowsTransientRetry<T>(operation: () => Promise<T>): Promise<T>;
/**
 * Best-effort removal used after the primary runtime path has already
 * succeeded or failed. Transient Windows locks must not turn a usable runtime
 * into an error, but leaving the directory behind should still be audible.
 */
export declare function ignoreCleanupFailure(ctx: Context, label: string, path: string): Promise<void>;
/**
 * Opportunistically remove abandoned runtime staging and quarantine trees.
 * Current names encode their owning runtime lock, so live preparation is
 * skipped. Legacy names are collected only when no runtime lock is active and
 * after a conservative 24-hour grace period because they cannot be associated
 * with a specific lock.
 */
export declare function garbageCollectRuntimeCache(ctx: Context, stateRoot: string, now?: number): Promise<void>;
export declare function isolatedPythonEnvironment(home: string): NodeJS.ProcessEnv;
/** Verify every packaged upstream file against the committed content manifest. */
export declare function verifyBundledUpstream(): Promise<UpstreamManifest>;
interface PythonBootstrapArtifact {
    url: string;
    sha256: string;
    size: number;
}
interface PythonBootstrapManifest {
    schemaVersion: 1;
    pythonVersion: string;
    buildTag: string;
    /** Optional domestic mirror base that replaces the GitHub download prefix. */
    mirrorBaseUrl?: string;
    artifacts: Record<string, PythonBootstrapArtifact>;
}
/** Map Node platform/arch to the pinned artifact name, including musl Linux. */
export declare function pythonBootstrapTarget(platform: string, arch: string, musl: boolean): string;
interface DownloadResponse {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: NodeJS.ReadableStream;
    close: () => Promise<void>;
}
type DownloadRequest = (url: string, signal: AbortSignal) => Promise<DownloadResponse>;
export declare function acquireBundledPython(ctx: Context, stateRoot: string, cwd: string, manifestOverride?: PythonBootstrapManifest, requestImpl?: DownloadRequest): Promise<{
    command: RuntimeCommand;
    version: string;
}>;
export declare function resolveBootstrapPython(ctx: Context, configured: string | undefined, cwd: string, manifestOverride?: PythonBootstrapManifest, requestImpl?: DownloadRequest): Promise<{
    command: RuntimeCommand;
    version: string;
    major: number;
    minor: number;
}>;
/** Persistent per-DSH-home cache root shared by runtime and Web support files. */
export declare function visionToolkitStateRoot(): string;
/**
 * Rewrite a staged venv's `pyvenv.cfg` `home`/`executable` to point at a given
 * base directory (the app execution alias directory for the Microsoft Store
 * Python). Pure helper so the transformation is testable cross-platform.
 */
export declare function rewriteVenvConfig(cfg: string, homeDir: string): string;
/**
 * Build the Microsoft Store probe environment while preserving Python-variable
 * tombstones; only the user-directory variables must fall back to the host.
 */
export declare function storePythonProbeEnvironment(installEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** Prepare the configured pinned runtime without making any vision API call. */
export declare function prepareUpstreamRuntime(ctx: Context, config: ResolvedVisionToolkitConfig): Promise<PreparedUpstreamRuntime>;
export {};
//# sourceMappingURL=runtime-install.d.ts.map