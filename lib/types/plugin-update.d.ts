/**
 * Profile-scoped self-update support for the Web Settings page.
 *
 * Only registry-installed copies are mutable. Local `link:`, `file:`, git,
 * URL, and workspace installs stay developer-owned and are reported as
 * unsupported instead of being replaced behind the user's back.
 * @module dsh-vision-toolkit/plugin-update
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const VISION_TOOLKIT_PACKAGE = "@anionex/dsh-vision-toolkit";
export type PluginUpdateUnavailableReason = 'profile-not-found' | 'not-direct-dependency' | 'unsupported-install-source' | 'profile-read-only' | 'pnpm-unavailable';
export interface PluginUpdateCapability {
    supported: boolean;
    profile?: string;
    dependencySpec?: string;
    reason?: PluginUpdateUnavailableReason;
}
export interface PluginUpdateCheck extends PluginUpdateCapability {
    currentVersion: string;
    latestVersion?: string;
    updateAvailable: boolean;
    checkedAt: string;
}
export interface PluginUpdateResult {
    fromVersion: string;
    toVersion: string;
    profile: string;
    restarting: true;
    retryAfterMs: number;
}
export declare class PluginUpdateError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: ErrorOptions);
}
export interface RestartRequest {
    pid: number;
    execPath: string;
    args: readonly string[];
    cwd: string;
    logPath: string;
}
export interface PluginUpdateServiceOptions {
    packageRoot?: string;
    profileDir?: string;
    dshHome?: string;
    argv?: readonly string[];
    now?: () => Date;
    prepareRestart?: (request: RestartRequest) => void;
    terminateCurrent?: () => void;
    schedule?: (callback: () => void, delayMs: number) => void;
}
/** Compare two strict SemVer versions. */
export declare function compareVersions(left: string, right: string): number;
/** Profile-aware updater used by the same-origin Settings backend. */
export declare class VisionToolkitPluginUpdateService {
    private readonly ctx;
    private readonly currentVersion;
    private readonly packageRoot;
    private readonly profileDir;
    private readonly dshHome;
    private readonly argv;
    private readonly now;
    private readonly prepareRestart;
    private readonly terminateCurrent;
    private readonly schedule;
    private locating?;
    private updating;
    constructor(ctx: Pick<Context, 'subprocess'>, currentVersion: string, options?: PluginUpdateServiceOptions);
    private inspectProfile;
    private locateProfile;
    private profile;
    /** Report whether the current installation can be safely replaced in place. */
    capability(): Promise<PluginUpdateCapability>;
    private runPnpm;
    /** Query the configured npm registry without mutating the profile. */
    check(): Promise<PluginUpdateCheck>;
    /** Install the currently published version, then restart this DSH process. */
    installAndRestart(expectedVersion: string): Promise<PluginUpdateResult>;
}
//# sourceMappingURL=plugin-update.d.ts.map