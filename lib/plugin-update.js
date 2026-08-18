/**
 * Profile-scoped self-update support for the Web Settings page.
 *
 * Only registry-installed copies are mutable. Local `link:`, `file:`, git,
 * URL, and workspace installs stay developer-owned and are reported as
 * unsupported instead of being replaced behind the user's back.
 * @module dsh-vision-toolkit/plugin-update
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, constants as fsConstants, fchmodSync, mkdirSync, openSync } from 'node:fs';
import { access, mkdir, open as openFile, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const VISION_TOOLKIT_PACKAGE = '@anionex/dsh-vision-toolkit';
const CHECK_TIMEOUT_MS = 20_000;
const UPDATE_TIMEOUT_MS = 180_000;
const RESTART_ROLLBACK_TIMEOUT_MS = 120_000;
const OLD_PROCESS_EXIT_TIMEOUT_MS = 30_000;
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
const { chmodSync, existsSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } = require('node:fs')
const payload = JSON.parse(Buffer.from(process.argv[1], 'base64url').toString('utf8'))
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay))
const log = message => console.log('[dsh-vision-toolkit]', message)
let lockTransferred = false
const alive = pid => {
  try { process.kill(pid, 0); return true }
  catch (error) { return Boolean(error && error.code === 'EPERM') }
}
const lockOwner = () => {
  try { return JSON.parse(readFileSync(payload.lockPath, 'utf8')) }
  catch { return undefined }
}
const ownsLock = () => lockOwner()?.token === payload.lockToken
const writeLock = owner => {
  const temp = payload.lockPath + '.' + process.pid + '.tmp'
  writeFileSync(temp, JSON.stringify(owner), { mode: 0o600 })
  renameSync(temp, payload.lockPath)
}
const transferLock = () => {
  if (!ownsLock()) return false
  writeLock({ pid: process.pid, token: payload.lockToken, startedAt: new Date().toISOString(), role: 'restart-helper' })
  lockTransferred = true
  return true
}
const removeLock = () => {
  if (!ownsLock()) return
  try { unlinkSync(payload.lockPath) }
  catch (error) { if (!error || error.code !== 'ENOENT') console.error('[dsh-vision-toolkit] lock cleanup failed:', error) }
}
const cleanupBackup = () => {
  try { rmSync(payload.backupDir, { recursive: true, force: true }) }
  catch (error) { console.error('[dsh-vision-toolkit] backup cleanup failed:', error) }
}
const preserveRecovery = message => {
  console.error('[dsh-vision-toolkit]', message + '; recovery files preserved at ' + payload.backupDir
    + ' and update lock preserved at ' + payload.lockPath)
}
const atomicWrite = (path, contents, mode) => {
  const temp = path + '.' + process.pid + '.tmp'
  writeFileSync(temp, contents, { mode })
  chmodSync(temp, mode)
  renameSync(temp, path)
}
const validateBackup = () => {
  const metadata = JSON.parse(readFileSync(payload.backupDir + '/metadata.json', 'utf8'))
  readFileSync(payload.backupDir + '/package.json')
  if (metadata.hadLockfile) readFileSync(payload.backupDir + '/pnpm-lock.yaml')
  return metadata
}
const acknowledgeHandoff = () => {
  atomicWrite(payload.handoffPath, JSON.stringify({ pid: process.pid, token: payload.lockToken }), 0o600)
}
const restoreProfileFiles = () => {
  const manifest = readFileSync(payload.backupDir + '/package.json')
  const metadata = JSON.parse(readFileSync(payload.backupDir + '/metadata.json', 'utf8'))
  atomicWrite(payload.profileDir + '/package.json', manifest, metadata.manifestMode)
  const lockfile = payload.profileDir + '/pnpm-lock.yaml'
  if (metadata.hadLockfile) {
    atomicWrite(lockfile, readFileSync(payload.backupDir + '/pnpm-lock.yaml'), metadata.lockfileMode)
  }
  else if (existsSync(lockfile)) unlinkSync(lockfile)
}
const killChild = (child, signal) => {
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch {}
}
const runPnpm = args => new Promise(resolve => {
  let settled = false
  let killTimer
  let finalTimer
  const finish = value => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    clearTimeout(killTimer)
    clearTimeout(finalTimer)
    resolve(value)
  }
  const child = spawn(payload.pnpmPath, args, {
    cwd: payload.profileDir,
    env: process.env,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  child.once('error', error => {
    console.error('[dsh-vision-toolkit] rollback pnpm failed:', error)
    finish(false)
  })
  child.once('exit', code => { finish(code === 0) })
  const timeout = setTimeout(() => {
    console.error('[dsh-vision-toolkit] rollback pnpm timed out')
    killChild(child, 'SIGTERM')
    killTimer = setTimeout(() => {
      killChild(child, 'SIGKILL')
      finalTimer = setTimeout(() => { finish(false) }, payload.processKillGraceMs)
    }, payload.processKillGraceMs)
  }, payload.rollbackTimeoutMs)
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
      const runtimeReady = body && body.value && body.value.runtime && body.value.runtime.ready === true
      if (response.ok && body && body.ok && body.value && body.value.release
        && body.value.release.pluginVersion === version
        && (!payload.baselineRuntimeReady || runtimeReady)) return true
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
const installedVersion = () => {
  const manifest = JSON.parse(readFileSync(payload.profileDir + '/node_modules/'
    + payload.packageName + '/package.json', 'utf8'))
  return manifest && manifest.version
}
const rollbackInstall = async metadata => {
  try { restoreProfileFiles() }
  catch (error) {
    console.error('[dsh-vision-toolkit] profile file restore before rollback failed:', error)
    return false
  }
  const args = metadata.hadLockfile
    ? ['install', '--frozen-lockfile', '--reporter=append-only']
    : ['add', payload.packageName + '@' + payload.fromVersion, '--save-exact', '--yes', '--reporter=append-only']
  const installed = await runPnpm(args)
  try { restoreProfileFiles() }
  catch (error) {
    console.error('[dsh-vision-toolkit] profile file restore after rollback failed:', error)
    return false
  }
  if (!installed) {
    console.error('[dsh-vision-toolkit] rollback pnpm failed')
    return false
  }
  try {
    const version = installedVersion()
    if (version !== payload.fromVersion) console.error('[dsh-vision-toolkit] rollback installed ' + version + ' instead of ' + payload.fromVersion)
    return version === payload.fromVersion
  }
  catch (error) {
    console.error('[dsh-vision-toolkit] rollback version verification failed:', error)
    return false
  }
}
const restore = async metadata => {
  log('replacement did not become ready; restoring ' + payload.fromVersion)
  if (!await rollbackInstall(metadata)) return false
  const child = launch()
  child.once('error', error => { console.error('[dsh-vision-toolkit] rollback launch failed:', error) })
  if (!await ready(child, payload.fromVersion, payload.readinessTimeoutMs)) {
    console.error('[dsh-vision-toolkit] rollback replacement did not become ready')
    await stop(child)
    return false
  }
  child.unref()
  log('rollback is serving ' + payload.fromVersion)
  return true
}
const main = async () => {
  const metadata = validateBackup()
  if (!transferLock()) {
    console.error('[dsh-vision-toolkit] restart helper could not take ownership of the update lock')
    process.exit(1)
  }
  acknowledgeHandoff()
  const exitDeadline = Date.now() + payload.oldProcessExitTimeoutMs
  while (alive(payload.pid) && Date.now() < exitDeadline) await sleep(100)
  if (alive(payload.pid)) {
    log('old process did not exit; restoring package files without replacing the running process')
    const installed = await rollbackInstall(metadata)
    if (installed) {
      removeLock()
      cleanupBackup()
    } else preserveRecovery('old process did not exit and automatic package recovery failed')
    process.exit(1)
  }
  const child = launch()
  child.once('error', error => { console.error('[dsh-vision-toolkit] replacement launch failed:', error) })
  if (await ready(child, payload.toVersion, payload.readinessTimeoutMs)) {
    child.unref()
    removeLock()
    cleanupBackup()
    log('replacement is serving ' + payload.toVersion)
    process.exit(0)
  }
  await stop(child)
  const restored = await restore(metadata)
  if (restored) {
    removeLock()
    cleanupBackup()
  } else preserveRecovery('replacement and automatic rollback both failed')
  process.exit(restored ? 2 : 1)
}
main().catch(error => {
  console.error('[dsh-vision-toolkit] restart helper failed:', error)
  if (lockTransferred) preserveRecovery('restart helper failed before recovery completed')
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
    if (!/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65_535)
        return undefined;
    const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `http://${authority}:${port}${SETTINGS_ROUTE}`;
}
async function defaultPrepareRestart(request) {
    const payload = Buffer.from(JSON.stringify(request)).toString('base64url');
    mkdirSync(dirname(request.logPath), { recursive: true });
    const log = openSync(request.logPath, 'w', 0o600);
    let helper;
    let handoffAcknowledged = false;
    const stopHelper = async () => {
        if (helper === undefined || helper.exitCode !== null || helper.signalCode !== null)
            return;
        try {
            if (process.platform === 'win32')
                helper.kill('SIGTERM');
            else if (helper.pid !== undefined)
                process.kill(-helper.pid, 'SIGTERM');
        }
        catch { }
        const stopDeadline = Date.now() + 1_000;
        while (Date.now() < stopDeadline && helper.exitCode === null && helper.signalCode === null) {
            await new Promise(resolve => { setTimeout(resolve, 50); });
        }
        if (helper.exitCode === null && helper.signalCode === null) {
            try {
                if (process.platform === 'win32')
                    helper.kill('SIGKILL');
                else if (helper.pid !== undefined)
                    process.kill(-helper.pid, 'SIGKILL');
            }
            catch { }
            const killDeadline = Date.now() + 1_000;
            while (Date.now() < killDeadline && helper.exitCode === null && helper.signalCode === null) {
                await new Promise(resolve => { setTimeout(resolve, 50); });
            }
        }
    };
    try {
        fchmodSync(log, 0o600);
        helper = spawn(process.execPath, ['-e', PLUGIN_RESTART_HELPER_SOURCE, payload], {
            cwd: request.cwd,
            env: process.env,
            stdio: ['ignore', log, log],
            detached: true,
            windowsHide: true,
        });
        if (helper.pid === undefined)
            throw new Error('restart helper did not publish a process id');
        let spawnError;
        helper.once('error', (error) => { spawnError = error; });
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
            if (spawnError !== undefined)
                throw spawnError;
            if (helper.exitCode !== null || helper.signalCode !== null) {
                throw new Error(`restart helper exited before handoff with code ${String(helper.exitCode)}`);
            }
            try {
                const handoff = JSON.parse(await readFile(request.handoffPath, 'utf8'));
                if (handoff.pid === helper.pid && handoff.token === request.lockToken) {
                    handoffAcknowledged = true;
                    helper.unref();
                    return;
                }
            }
            catch (error) {
                if (!isNodeError(error) || error.code !== 'ENOENT')
                    throw error;
            }
            await new Promise(resolve => { setTimeout(resolve, 50); });
        }
        throw new Error('restart helper did not acknowledge lock and backup handoff');
    }
    catch (error) {
        if (!handoffAcknowledged)
            await stopHelper();
        throw error;
    }
    finally {
        closeSync(log);
    }
}
function defaultSchedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
}
async function createUpdateBackup(profileDir, token) {
    const dir = join(profileDir, `.dsh-vision-toolkit-update-backup-${token}`);
    try {
        await mkdir(dir, { mode: 0o700 });
        const manifestPath = join(profileDir, 'package.json');
        const manifest = await readFile(manifestPath);
        const manifestMode = (await stat(manifestPath)).mode & 0o777;
        await writeFile(join(dir, 'package.json'), manifest, { mode: 0o600 });
        let hadLockfile = true;
        let lockfileMode;
        try {
            const lockfilePath = join(profileDir, 'pnpm-lock.yaml');
            const lockfile = await readFile(lockfilePath);
            lockfileMode = (await stat(lockfilePath)).mode & 0o777;
            await writeFile(join(dir, 'pnpm-lock.yaml'), lockfile, { mode: 0o600 });
        }
        catch (error) {
            if (!isNodeError(error) || error.code !== 'ENOENT')
                throw error;
            hadLockfile = false;
        }
        await writeFile(join(dir, 'metadata.json'), JSON.stringify({ hadLockfile, manifestMode, lockfileMode }), { mode: 0o600 });
        return { dir, hadLockfile };
    }
    catch (error) {
        await rm(dir, { recursive: true, force: true }).catch(() => { });
        throw error;
    }
}
async function atomicRestore(path, contents, mode) {
    const staging = `${path}.${process.pid}.${randomUUID()}.restore`;
    try {
        await writeFile(staging, contents, { mode });
        await rename(staging, path);
    }
    finally {
        await unlink(staging).catch(() => { });
    }
}
async function restoreUpdateBackup(profileDir, backup) {
    const metadata = JSON.parse(await readFile(join(backup.dir, 'metadata.json'), 'utf8'));
    if (typeof metadata.manifestMode !== 'number')
        throw new Error('update backup is missing the manifest mode');
    await atomicRestore(join(profileDir, 'package.json'), await readFile(join(backup.dir, 'package.json')), metadata.manifestMode);
    const lockfilePath = join(profileDir, 'pnpm-lock.yaml');
    if (metadata.hadLockfile === true) {
        if (typeof metadata.lockfileMode !== 'number')
            throw new Error('update backup is missing the lockfile mode');
        await atomicRestore(lockfilePath, await readFile(join(backup.dir, 'pnpm-lock.yaml')), metadata.lockfileMode);
    }
    else {
        await unlink(lockfilePath).catch((error) => {
            if (!isNodeError(error) || error.code !== 'ENOENT')
                throw error;
        });
    }
}
async function cleanupUpdateBackup(backup) {
    await rm(backup.dir, { recursive: true, force: true });
}
function publicCommandFailure(result, fallback) {
    const detail = (result.stderr.trim() || result.stdout.trim())
        .replaceAll(homedir(), '~')
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/giu, '$1***@')
        .replace(/([?&](?:access[_-]?token|api[_-]?key|auth|key|password|token)=)[^&#\s]+/giu, '$1***')
        .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+)\S+/giu, '$1***')
        .replace(/((?:_auth(?:Token)?|token|password|_password)\s*[:=]\s*)\S+/giu, '$1***')
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
    runtimeReady;
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
        this.runtimeReady = options.runtimeReady ?? (() => true);
        this.platform = options.platform ?? process.platform;
    }
    /** Bind readiness checks to the active WebServer and reject ports that cannot be reproduced on restart. */
    configureWebServer(host, port) {
        const explicitPort = optionValue(this.argv, '--port')?.trim();
        const stable = explicitPort === undefined ? port === 3080 : Number(explicitPort) === port && port > 0;
        if (!stable || !Number.isInteger(port) || port < 1 || port > 65_535) {
            this.healthUrl = undefined;
            return;
        }
        const probeHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
        const authority = probeHost.includes(':') && !probeHost.startsWith('[') ? `[${probeHost}]` : probeHost;
        this.healthUrl = `http://${authority}:${port}${SETTINGS_ROUTE}`;
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
            await access(profile.profileDir, fsConstants.W_OK);
            await access(join(profile.profileDir, 'package.json'), fsConstants.W_OK);
            await access(dirname(profile.installedDir), fsConstants.W_OK);
            try {
                await access(join(profile.profileDir, 'pnpm-lock.yaml'), fsConstants.W_OK);
            }
            catch (error) {
                if (!isNodeError(error) || error.code !== 'ENOENT')
                    throw error;
            }
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
        // Replacing the registry package is safe even when this Web process cannot
        // restart itself. In that case the new code becomes active after the user
        // restarts DSH Web through their usual command or process manager.
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
        // Windows batch shims cannot be spawned directly; route them through cmd.exe.
        const program = this.platform === 'win32' && /\.(?:cmd|bat)$/i.test(pnpmPath)
            ? process.env.COMSPEC ?? 'cmd.exe'
            : pnpmPath;
        const argv = program === pnpmPath
            ? [pnpmPath, ...args]
            : [program, '/d', '/s', '/c', pnpmPath, ...args];
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        try {
            const handle = this.ctx.subprocess.spawn({
                argv,
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
    async rollbackInstall(backup, profile, pnpmPath) {
        await restoreUpdateBackup(profile.profileDir, backup);
        const args = backup.hadLockfile
            ? ['install', '--frozen-lockfile', '--reporter=append-only']
            : ['add', `${VISION_TOOLKIT_PACKAGE}@${this.currentVersion}`, '--save-exact', '--yes', '--reporter=append-only'];
        const result = await this.runPnpm(args, UPDATE_TIMEOUT_MS, profile, pnpmPath);
        let restored = true;
        try {
            await restoreUpdateBackup(profile.profileDir, backup);
        }
        catch {
            restored = false;
        }
        if (result.exitCode !== 0 || !restored)
            return false;
        try {
            const restored = await jsonFile(join(profile.installedDir, 'package.json'));
            return restored.version === this.currentVersion;
        }
        catch {
            return false;
        }
    }
    async acquireLock(profileDir) {
        const path = join(profileDir, UPDATE_LOCK_FILE);
        const token = randomUUID();
        try {
            const handle = await openFile(path, 'wx', 0o600);
            try {
                await handle.writeFile(JSON.stringify({
                    pid: process.pid,
                    token,
                    startedAt: this.now().toISOString(),
                    role: 'updater',
                }));
            }
            finally {
                await handle.close();
            }
        }
        catch (error) {
            if (isNodeError(error) && error.code === 'EEXIST') {
                throw new PluginUpdateError('update-in-progress', `Another process owns the DSH profile update lock; remove ${UPDATE_LOCK_FILE} manually only after confirming no update or restart helper is running`);
            }
            throw error;
        }
        return {
            path,
            token,
            release: async () => {
                let owner;
                try {
                    owner = JSON.parse(await readFile(path, 'utf8'));
                }
                catch (error) {
                    if (isNodeError(error) && error.code === 'ENOENT')
                        return;
                    throw error;
                }
                if (owner.token !== token) {
                    throw new PluginUpdateError('update-lock-release-failed', 'The profile update lock owner changed before release');
                }
                await unlink(path);
            },
        };
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
    /** Install the currently published version, then restart when this process can do so safely. */
    async installAndRestart(expectedVersion) {
        if (this.updating)
            throw new PluginUpdateError('update-in-progress', 'A plugin update is already in progress');
        this.updating = true;
        let locked;
        let updateContext;
        let updateBackup;
        let updateAttempted = false;
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
            updateBackup = await createUpdateBackup(final.profile.profileDir, locked.token);
            updateAttempted = true;
            const result = await this.runPnpm([
                'add', `${VISION_TOOLKIT_PACKAGE}@${expectedVersion}`, '--save-exact', '--yes', '--reporter=append-only',
            ], UPDATE_TIMEOUT_MS, final.profile, final.pnpmPath);
            if (result.exitCode !== 0) {
                throw new PluginUpdateError('update-failed', publicCommandFailure(result, 'Plugin update failed'));
            }
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
            const healthUrl = this.healthUrl;
            if (this.platform === 'win32' || !this.allowDetachedRestart || healthUrl === undefined) {
                await cleanupUpdateBackup(updateBackup);
                updateBackup = undefined;
                await locked.release();
                locked = undefined;
                this.updating = false;
                return {
                    fromVersion: this.currentVersion,
                    toVersion: installedVersion,
                    profile: final.profile.profile,
                    restarting: false,
                    manualRestartRequired: true,
                };
            }
            try {
                await this.prepareRestart({
                    pid: process.pid,
                    execPath: process.execPath,
                    args: [...process.execArgv, ...process.argv.slice(1)],
                    cwd: process.cwd(),
                    logPath: join(this.dshHome, 'logs', 'vision-toolkit-restart.log'),
                    lockPath: locked.path,
                    lockToken: locked.token,
                    backupDir: updateBackup.dir,
                    handoffPath: join(updateBackup.dir, 'handoff.json'),
                    profileDir: final.profile.profileDir,
                    pnpmPath: final.pnpmPath,
                    packageName: VISION_TOOLKIT_PACKAGE,
                    fromVersion: this.currentVersion,
                    toVersion: installedVersion,
                    healthUrl,
                    baselineRuntimeReady: this.runtimeReady(),
                    rollbackTimeoutMs: RESTART_ROLLBACK_TIMEOUT_MS,
                    processKillGraceMs: 5_000,
                    readinessTimeoutMs: 60_000,
                    oldProcessExitTimeoutMs: OLD_PROCESS_EXIT_TIMEOUT_MS,
                });
            }
            catch (error) {
                throw new PluginUpdateError('restart-failed', `Plugin ${installedVersion} was installed, but automatic restart could not be prepared`, { cause: error });
            }
            this.schedule(this.terminateCurrent, RESTART_DELAY_MS);
            updateBackup = undefined;
            return {
                fromVersion: this.currentVersion,
                toVersion: installedVersion,
                profile: final.profile.profile,
                restarting: true,
                retryAfterMs: RESTART_RETRY_AFTER_MS,
            };
        }
        catch (error) {
            if (updateAttempted && updateContext !== undefined && updateBackup !== undefined) {
                let rollbackFailure;
                try {
                    if (!await this.rollbackInstall(updateBackup, updateContext.profile, updateContext.pnpmPath)) {
                        rollbackFailure = new PluginUpdateError('update-rollback-failed', 'Plugin update failed and the previous version could not be restored', { cause: error });
                    }
                }
                catch (rollbackError) {
                    rollbackFailure = new PluginUpdateError('update-rollback-failed', 'Plugin update failed and the previous version could not be restored', { cause: rollbackError });
                }
                try {
                    await restoreUpdateBackup(updateContext.profile.profileDir, updateBackup);
                }
                catch (restoreError) {
                    rollbackFailure = new PluginUpdateError('update-rollback-failed', 'Plugin update failed and the original profile files could not be restored', { cause: restoreError });
                }
                if (rollbackFailure === undefined) {
                    try {
                        await cleanupUpdateBackup(updateBackup);
                    }
                    catch (cleanupError) {
                        rollbackFailure = new PluginUpdateError('update-rollback-failed', 'Plugin update failed and its completed recovery backup could not be removed', { cause: cleanupError });
                    }
                }
                else {
                    rollbackFailure = new PluginUpdateError(rollbackFailure.code, `${rollbackFailure.message}; recovery files preserved at ${updateBackup.dir}`, { cause: rollbackFailure });
                }
                if (rollbackFailure !== undefined)
                    error = rollbackFailure;
            }
            const preserveLock = error instanceof PluginUpdateError
                && error.code === 'update-rollback-failed'
                && updateBackup !== undefined;
            if (locked !== undefined && !preserveLock) {
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