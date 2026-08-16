/**
 * Profile-scoped self-update support for the Web Settings page.
 *
 * Only registry-installed copies are mutable. Local `link:`, `file:`, git,
 * URL, and workspace installs stay developer-owned and are reported as
 * unsupported instead of being replaced behind the user's back.
 * @module dsh-vision-toolkit/plugin-update
 */
import { spawn } from 'node:child_process';
import { closeSync, constants as fsConstants, fchmodSync, mkdirSync, openSync } from 'node:fs';
import { access, open as openFile, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const VISION_TOOLKIT_PACKAGE = '@anionex/dsh-vision-toolkit';
const CHECK_TIMEOUT_MS = 20_000;
const UPDATE_TIMEOUT_MS = 180_000;
const RESTART_DELAY_MS = 750;
const RESTART_RETRY_AFTER_MS = 1_200;
const COMMAND_OUTPUT_BYTES = 128 * 1024;
const SETTINGS_ROUTE = '/_dsh/vision-toolkit/settings';
const UPDATE_LOCK_FILE = '.dsh-vision-toolkit-update.lock';
export class PluginUpdateError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.code = code;
        this.name = 'PluginUpdateError';
    }
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
/** @internal Restart helper source exported for lifecycle integration tests. */
export const PLUGIN_RESTART_HELPER_SOURCE = String.raw `
const { spawn } = require('node:child_process')
const { unlinkSync } = require('node:fs')
const payload = JSON.parse(Buffer.from(process.argv[1], 'base64url').toString('utf8'))
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay))
const log = message => console.log('[dsh-vision-toolkit]', message)
const alive = pid => {
  try { process.kill(pid, 0); return true }
  catch (error) { return Boolean(error && error.code === 'EPERM') }
}
const removeLock = () => {
  try { unlinkSync(payload.lockPath) }
  catch (error) { if (!error || error.code !== 'ENOENT') console.error('[dsh-vision-toolkit] lock cleanup failed:', error) }
}
const runPnpm = version => new Promise(resolve => {
  const child = spawn(payload.pnpmPath, [
    'add', payload.packageName + '@' + version, '--save-exact', '--yes', '--reporter=append-only',
  ], {
    cwd: payload.profileDir,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', error => {
    console.error('[dsh-vision-toolkit] rollback pnpm failed:', error)
    resolve(false)
  })
  child.once('exit', code => { resolve(code === 0) })
})
const launch = () => spawn(payload.execPath, payload.args, {
  cwd: payload.cwd,
  env: process.env,
  stdio: 'ignore',
  detached: true,
  windowsHide: true,
})
const ready = async (child, version, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return false
    try {
      const response = await fetch(payload.healthUrl, { signal: AbortSignal.timeout(2000) })
      const body = await response.json()
      if (response.ok && body && body.ok && body.value && body.value.release
        && body.value.release.pluginVersion === version) return true
    } catch {}
    await sleep(500)
  }
  return false
}
const stop = async child => {
  if (child.exitCode !== null || child.signalCode !== null) return
  try { child.kill('SIGTERM') } catch {}
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) await sleep(100)
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL') } catch {}
  }
}
const restore = async () => {
  log('replacement did not become ready; restoring ' + payload.fromVersion)
  if (!await runPnpm(payload.fromVersion)) return false
  const child = launch()
  child.once('error', error => { console.error('[dsh-vision-toolkit] rollback launch failed:', error) })
  if (!await ready(child, payload.fromVersion, 60000)) {
    await stop(child)
    return false
  }
  child.unref()
  log('rollback is serving ' + payload.fromVersion)
  return true
}
const main = async () => {
  const exitDeadline = Date.now() + 120000
  while (alive(payload.pid) && Date.now() < exitDeadline) await sleep(100)
  if (alive(payload.pid)) {
    log('old process did not exit; restoring package files without replacing the running process')
    await runPnpm(payload.fromVersion)
    removeLock()
    process.exit(1)
  }
  const child = launch()
  child.once('error', error => { console.error('[dsh-vision-toolkit] replacement launch failed:', error) })
  if (await ready(child, payload.toVersion, 60000)) {
    child.unref()
    removeLock()
    log('replacement is serving ' + payload.toVersion)
    process.exit(0)
  }
  await stop(child)
  const restored = await restore()
  removeLock()
  process.exit(restored ? 2 : 1)
}
main().catch(error => {
  console.error('[dsh-vision-toolkit] restart helper failed:', error)
  removeLock()
  process.exit(1)
})
`;
function parseSemver(value) {
    const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value);
    if (match === null)
        return undefined;
    const prerelease = match[4] === undefined
        ? []
        : match[4].split('.').map(part => /^\d+$/u.test(part) ? Number(part) : part);
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease,
    };
}
/** Compare two strict SemVer versions. */
export function compareVersions(left, right) {
    const a = parseSemver(left);
    const b = parseSemver(right);
    if (a === undefined || b === undefined)
        return left.localeCompare(right);
    for (const key of ['major', 'minor', 'patch']) {
        if (a[key] !== b[key])
            return a[key] < b[key] ? -1 : 1;
    }
    if (a.prerelease.length === 0 || b.prerelease.length === 0) {
        if (a.prerelease.length === b.prerelease.length)
            return 0;
        return a.prerelease.length === 0 ? 1 : -1;
    }
    const count = Math.max(a.prerelease.length, b.prerelease.length);
    for (let index = 0; index < count; index += 1) {
        const x = a.prerelease[index];
        const y = b.prerelease[index];
        if (x === undefined || y === undefined)
            return x === undefined ? -1 : 1;
        if (x === y)
            continue;
        if (typeof x === 'number' && typeof y === 'number')
            return x < y ? -1 : 1;
        if (typeof x === 'number')
            return -1;
        if (typeof y === 'number')
            return 1;
        return x.localeCompare(y);
    }
    return 0;
}
function registryInstallSpec(spec) {
    const normalized = spec.trim().toLowerCase();
    return normalized.length > 0
        && !/^[a-z][a-z0-9+.-]*:/u.test(normalized)
        && !normalized.includes('/')
        && !normalized.includes('\\');
}
function profileHint(argv) {
    if (argv[0] === 'web')
        return 'web';
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value?.startsWith('--profile='))
            return value.slice('--profile='.length);
        if (value === '--profile')
            return argv[index + 1];
    }
    return undefined;
}
async function jsonFile(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}
async function sameRealPath(left, right) {
    try {
        return await realpath(left) === await realpath(right);
    }
    catch {
        return false;
    }
}
function defaultPackageRoot() {
    return dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
}
function defaultDshHome() {
    return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
}
function optionValue(argv, name) {
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value?.startsWith(`${name}=`))
            return value.slice(name.length + 1);
        if (value === name)
            return argv[index + 1];
    }
    return undefined;
}
function defaultHealthUrl(argv) {
    const configuredHost = optionValue(argv, '--host')?.trim() || '127.0.0.1';
    const host = configuredHost === '0.0.0.0' || configuredHost === '::' ? '127.0.0.1' : configuredHost;
    const port = optionValue(argv, '--port')?.trim() || '3080';
    const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `http://${authority}:${port}${SETTINGS_ROUTE}`;
}
function defaultPrepareRestart(request) {
    const payload = Buffer.from(JSON.stringify(request)).toString('base64url');
    mkdirSync(dirname(request.logPath), { recursive: true });
    const log = openSync(request.logPath, 'w', 0o600);
    try {
        fchmodSync(log, 0o600);
        const helper = spawn(process.execPath, ['-e', PLUGIN_RESTART_HELPER_SOURCE, payload], {
            cwd: request.cwd,
            env: process.env,
            stdio: ['ignore', log, log],
            detached: true,
            windowsHide: true,
        });
        if (helper.pid === undefined)
            throw new Error('restart helper did not publish a process id');
        helper.unref();
    }
    finally {
        closeSync(log);
    }
}
function defaultSchedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
}
function publicCommandFailure(result, fallback) {
    const detail = (result.stderr.trim() || result.stdout.trim())
        .replaceAll(homedir(), '~')
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/giu, '$1***:***@')
        .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+)\S+/giu, '$1***')
        .replace(/((?:_authToken|token|password|_password)\s*[:=]\s*)\S+/giu, '$1***')
        .replace(/\bnpm_[A-Za-z0-9_-]+\b/gu, 'npm_***');
    if (result.timedOut)
        return `${fallback}: command timed out`;
    if (detail.length === 0)
        return `${fallback}: pnpm exited with code ${String(result.exitCode)}`;
    return `${fallback}: ${detail.slice(-1_000)}`;
}
/** Profile-aware updater used by the same-origin Settings backend. */
export class VisionToolkitPluginUpdateService {
    ctx;
    currentVersion;
    packageRoot;
    profileDir;
    dshHome;
    argv;
    now;
    prepareRestart;
    terminateCurrent;
    schedule;
    allowDetachedRestart;
    healthUrl;
    platform;
    updating = false;
    constructor(ctx, currentVersion, options = {}) {
        this.ctx = ctx;
        this.currentVersion = currentVersion;
        this.packageRoot = options.packageRoot ?? defaultPackageRoot();
        this.profileDir = options.profileDir;
        this.dshHome = options.dshHome ?? defaultDshHome();
        this.argv = options.argv ?? process.argv.slice(2);
        this.now = options.now ?? (() => new Date());
        this.prepareRestart = options.prepareRestart ?? defaultPrepareRestart;
        this.terminateCurrent = options.terminateCurrent ?? (() => { process.kill(process.pid, 'SIGTERM'); });
        this.schedule = options.schedule ?? defaultSchedule;
        this.allowDetachedRestart = options.allowDetachedRestart
            ?? process.env.DSH_VISION_TOOLKIT_ALLOW_DETACHED_RESTART === '1';
        this.healthUrl = options.healthUrl ?? defaultHealthUrl(this.argv);
        this.platform = options.platform ?? process.platform;
    }
    async inspectProfile(profileDir, profile) {
        const manifestPath = join(profileDir, 'package.json');
        const installedDir = join(profileDir, 'node_modules', ...VISION_TOOLKIT_PACKAGE.split('/'));
        let manifest;
        try {
            manifest = await jsonFile(manifestPath);
        }
        catch {
            return undefined;
        }
        if (!(await sameRealPath(installedDir, this.packageRoot)))
            return undefined;
        const dependencySpec = manifest.dependencies?.[VISION_TOOLKIT_PACKAGE];
        if (dependencySpec === undefined) {
            return { supported: false, profile, reason: 'not-direct-dependency' };
        }
        return { profile, profileDir, installedDir, dependencySpec };
    }
    async locateProfile() {
        const hint = profileHint(this.argv);
        if (this.profileDir !== undefined) {
            const inspected = await this.inspectProfile(this.profileDir, hint ?? 'web');
            if (inspected === undefined)
                return { supported: false, reason: 'profile-not-found' };
            return inspected;
        }
        const profilesDir = join(this.dshHome, 'profiles');
        const names = new Set();
        if (hint !== undefined && hint.length > 0)
            names.add(hint);
        try {
            for (const entry of await readdir(profilesDir, { withFileTypes: true })) {
                if (entry.isDirectory())
                    names.add(entry.name);
            }
        }
        catch {
            return { supported: false, reason: 'profile-not-found' };
        }
        let found;
        for (const name of names) {
            const inspected = await this.inspectProfile(join(profilesDir, name), name);
            if (inspected === undefined)
                continue;
            if ('supported' in inspected)
                return inspected;
            if (found !== undefined && hint === undefined)
                return { supported: false, reason: 'profile-not-found' };
            found = inspected;
            if (name === hint)
                break;
        }
        return found ?? { supported: false, reason: 'profile-not-found' };
    }
    async profile() {
        return await this.locateProfile();
    }
    async evaluate() {
        const checked = await this.checkContext();
        if (checked.profile === undefined || checked.pnpmPath === undefined)
            return { capability: checked.capability };
        const { profile, pnpmPath } = checked;
        if (!registryInstallSpec(profile.dependencySpec)) {
            return {
                capability: {
                    supported: false,
                    checkSupported: true,
                    profile: profile.profile,
                    dependencySpec: profile.dependencySpec,
                    reason: 'unsupported-install-source',
                },
            };
        }
        try {
            await access(join(profile.profileDir, 'package.json'), fsConstants.W_OK);
        }
        catch {
            return {
                capability: {
                    supported: false,
                    checkSupported: true,
                    profile: profile.profile,
                    dependencySpec: profile.dependencySpec,
                    reason: 'profile-read-only',
                },
            };
        }
        if (this.platform === 'win32') {
            return {
                capability: {
                    supported: false,
                    checkSupported: true,
                    profile: profile.profile,
                    dependencySpec: profile.dependencySpec,
                    reason: 'unsupported-platform',
                },
            };
        }
        if (!this.allowDetachedRestart) {
            return {
                capability: {
                    supported: false,
                    checkSupported: true,
                    profile: profile.profile,
                    dependencySpec: profile.dependencySpec,
                    reason: 'restart-unmanaged',
                },
            };
        }
        return {
            capability: { supported: true, checkSupported: true, profile: profile.profile, dependencySpec: profile.dependencySpec },
            profile,
            pnpmPath,
        };
    }
    async checkContext() {
        const profile = await this.profile();
        if ('supported' in profile)
            return { capability: { ...profile, checkSupported: false } };
        let pnpmPath;
        try {
            pnpmPath = await this.ctx.subprocess.resolveExecutable('pnpm');
        }
        catch {
            return {
                capability: {
                    supported: false,
                    checkSupported: false,
                    profile: profile.profile,
                    dependencySpec: profile.dependencySpec,
                    reason: 'pnpm-unavailable',
                },
            };
        }
        return {
            capability: {
                supported: false,
                checkSupported: true,
                profile: profile.profile,
                dependencySpec: profile.dependencySpec,
            },
            profile,
            pnpmPath,
        };
    }
    /** Report whether the current installation can be safely replaced in place. */
    async capability() {
        return (await this.evaluate()).capability;
    }
    async runPnpm(args, timeoutMs, profile, pnpmPath) {
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        try {
            const handle = this.ctx.subprocess.spawn({
                argv: [pnpmPath, ...args],
                cwd: profile.profileDir,
                stdio: {
                    stdin: 'ignore',
                    stdout: { maxBytes: COMMAND_OUTPUT_BYTES },
                    stderr: { maxBytes: COMMAND_OUTPUT_BYTES },
                },
                graceMs: 5_000,
                signal: controller.signal,
            });
            const outcome = await handle.done;
            return {
                stdout: handle.collected.stdout?.readFrom(0).text ?? '',
                stderr: handle.collected.stderr?.readFrom(0).text ?? '',
                exitCode: outcome.exitCode,
                timedOut,
            };
        }
        catch (error) {
            if (timedOut)
                return { stdout: '', stderr: '', exitCode: null, timedOut: true };
            throw new PluginUpdateError('pnpm-failed', 'Could not start pnpm', { cause: error });
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async acquireLock(profileDir) {
        const path = join(profileDir, UPDATE_LOCK_FILE);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const handle = await openFile(path, 'wx', 0o600);
                try {
                    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: this.now().toISOString() }));
                }
                finally {
                    await handle.close();
                }
                return {
                    path,
                    release: async () => {
                        try {
                            await unlink(path);
                        }
                        catch (error) {
                            if (!isNodeError(error) || error.code !== 'ENOENT')
                                throw error;
                        }
                    },
                };
            }
            catch (error) {
                if (!isNodeError(error) || error.code !== 'EEXIST')
                    throw error;
                let ownerAlive = true;
                try {
                    const parsed = JSON.parse(await readFile(path, 'utf8'));
                    if (typeof parsed.pid !== 'number' || !Number.isSafeInteger(parsed.pid))
                        ownerAlive = false;
                    else {
                        try {
                            process.kill(parsed.pid, 0);
                        }
                        catch (killError) {
                            ownerAlive = isNodeError(killError) && killError.code === 'EPERM';
                        }
                    }
                }
                catch {
                    ownerAlive = false;
                }
                if (ownerAlive)
                    throw new PluginUpdateError('update-in-progress', 'Another process is updating this DSH profile');
                try {
                    await unlink(path);
                }
                catch (unlinkError) {
                    if (!isNodeError(unlinkError) || unlinkError.code !== 'ENOENT')
                        throw unlinkError;
                }
            }
        }
        throw new PluginUpdateError('update-in-progress', 'Could not acquire the DSH profile update lock');
    }
    /** Query the configured npm registry without mutating the profile. */
    async check() {
        const context = await this.checkContext();
        if (context.profile === undefined || context.pnpmPath === undefined) {
            return {
                ...context.capability,
                currentVersion: this.currentVersion,
                updateAvailable: false,
                checkedAt: this.now().toISOString(),
            };
        }
        const capability = (await this.evaluate()).capability;
        const result = await this.runPnpm(['view', VISION_TOOLKIT_PACKAGE, 'version', '--json'], CHECK_TIMEOUT_MS, context.profile, context.pnpmPath);
        if (result.exitCode !== 0) {
            throw new PluginUpdateError('update-check-failed', publicCommandFailure(result, 'Could not check the npm registry'));
        }
        let latestVersion;
        try {
            const parsed = JSON.parse(result.stdout.trim());
            if (typeof parsed !== 'string' || parseSemver(parsed) === undefined)
                throw new Error('invalid version');
            latestVersion = parsed;
        }
        catch (error) {
            throw new PluginUpdateError('update-check-failed', 'The npm registry returned an invalid plugin version', { cause: error });
        }
        return {
            ...capability,
            currentVersion: this.currentVersion,
            latestVersion,
            updateAvailable: compareVersions(latestVersion, this.currentVersion) > 0,
            checkedAt: this.now().toISOString(),
        };
    }
    /** Install the currently published version, then restart this DSH process. */
    async installAndRestart(expectedVersion) {
        if (this.updating)
            throw new PluginUpdateError('update-in-progress', 'A plugin update is already in progress');
        this.updating = true;
        let locked;
        let updateContext;
        let packageChanged = false;
        try {
            const initial = await this.evaluate();
            if (!initial.capability.supported || initial.profile === undefined || initial.pnpmPath === undefined) {
                throw new PluginUpdateError('update-unavailable', 'Plugin update is unavailable for this installation');
            }
            locked = await this.acquireLock(initial.profile.profileDir);
            const check = await this.check();
            if (!check.supported || check.latestVersion === undefined) {
                throw new PluginUpdateError('update-unavailable', 'Plugin update is unavailable for this installation');
            }
            if (check.latestVersion !== expectedVersion) {
                throw new PluginUpdateError('update-stale', `The latest version changed from ${expectedVersion} to ${check.latestVersion}; check again before updating`);
            }
            if (!check.updateAvailable) {
                throw new PluginUpdateError('already-current', `Plugin ${this.currentVersion} is already up to date`);
            }
            const final = await this.evaluate();
            if (!final.capability.supported || final.profile === undefined || final.pnpmPath === undefined
                || final.profile.profileDir !== initial.profile.profileDir) {
                throw new PluginUpdateError('update-unavailable', 'The plugin installation changed while preparing the update');
            }
            updateContext = { profile: final.profile, pnpmPath: final.pnpmPath };
            const result = await this.runPnpm([
                'add', `${VISION_TOOLKIT_PACKAGE}@${expectedVersion}`, '--save-exact', '--yes', '--reporter=append-only',
            ], UPDATE_TIMEOUT_MS, final.profile, final.pnpmPath);
            if (result.exitCode !== 0) {
                throw new PluginUpdateError('update-failed', publicCommandFailure(result, 'Plugin update failed'));
            }
            packageChanged = true;
            let installedVersion;
            try {
                const installed = await jsonFile(join(final.profile.installedDir, 'package.json'));
                if (typeof installed.version !== 'string')
                    throw new Error('missing version');
                installedVersion = installed.version;
            }
            catch (error) {
                throw new PluginUpdateError('update-verify-failed', 'The updated package version could not be verified', { cause: error });
            }
            if (installedVersion !== expectedVersion) {
                throw new PluginUpdateError('update-verify-failed', `pnpm completed, but installed ${installedVersion} instead of ${expectedVersion}`);
            }
            try {
                this.prepareRestart({
                    pid: process.pid,
                    execPath: process.execPath,
                    args: [...process.execArgv, ...process.argv.slice(1)],
                    cwd: process.cwd(),
                    logPath: join(this.dshHome, 'logs', 'vision-toolkit-restart.log'),
                    lockPath: locked.path,
                    profileDir: final.profile.profileDir,
                    pnpmPath: final.pnpmPath,
                    packageName: VISION_TOOLKIT_PACKAGE,
                    fromVersion: this.currentVersion,
                    toVersion: installedVersion,
                    healthUrl: this.healthUrl,
                });
            }
            catch (error) {
                throw new PluginUpdateError('restart-failed', `Plugin ${installedVersion} was installed, but automatic restart could not be prepared`, { cause: error });
            }
            this.schedule(this.terminateCurrent, RESTART_DELAY_MS);
            return {
                fromVersion: this.currentVersion,
                toVersion: installedVersion,
                profile: final.profile.profile,
                restarting: true,
                retryAfterMs: RESTART_RETRY_AFTER_MS,
            };
        }
        catch (error) {
            if (packageChanged && updateContext !== undefined) {
                try {
                    const rollback = await this.runPnpm([
                        'add', `${VISION_TOOLKIT_PACKAGE}@${this.currentVersion}`, '--save-exact', '--yes', '--reporter=append-only',
                    ], UPDATE_TIMEOUT_MS, updateContext.profile, updateContext.pnpmPath);
                    if (rollback.exitCode !== 0) {
                        error = new PluginUpdateError('update-rollback-failed', publicCommandFailure(rollback, 'Plugin update failed and the previous version could not be restored'), { cause: error });
                    }
                }
                catch (rollbackError) {
                    error = new PluginUpdateError('update-rollback-failed', 'Plugin update failed and the previous version could not be restored', { cause: rollbackError });
                }
            }
            if (locked !== undefined) {
                try {
                    await locked.release();
                }
                catch (releaseError) {
                    error = new PluginUpdateError('update-lock-release-failed', 'The profile update lock could not be released', {
                        cause: releaseError,
                    });
                }
            }
            this.updating = false;
            throw error;
        }
    }
}
//# sourceMappingURL=plugin-update.js.map