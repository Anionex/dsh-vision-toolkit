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
/** Verify every packaged upstream file against the committed content manifest. */
export declare function verifyBundledUpstream(): Promise<UpstreamManifest>;
/** Persistent per-DSH-home cache root shared by runtime and Web support files. */
export declare function visionToolkitStateRoot(): string;
/** Prepare the configured pinned runtime without making any vision API call. */
export declare function prepareUpstreamRuntime(ctx: Context, config: ResolvedVisionToolkitConfig): Promise<PreparedUpstreamRuntime>;
export {};
//# sourceMappingURL=runtime-install.d.ts.map