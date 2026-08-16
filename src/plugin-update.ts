/**
 * Profile-scoped self-update support for the Web Settings page.
 *
 * Only registry-installed copies are mutable. Local `link:`, `file:`, git,
 * URL, and workspace installs stay developer-owned and are reported as
 * unsupported instead of being replaced behind the user's back.
 * @module dsh-vision-toolkit/plugin-update
 */

import { spawn } from 'node:child_process'
import { closeSync, constants as fsConstants, mkdirSync, openSync } from 'node:fs'
import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

export const VISION_TOOLKIT_PACKAGE = '@anionex/dsh-vision-toolkit'

const CHECK_TIMEOUT_MS = 20_000
const UPDATE_TIMEOUT_MS = 180_000
const RESTART_DELAY_MS = 750
const RESTART_RETRY_AFTER_MS = 1_200
const COMMAND_OUTPUT_BYTES = 128 * 1024

export type PluginUpdateUnavailableReason =
  | 'profile-not-found'
  | 'not-direct-dependency'
  | 'unsupported-install-source'
  | 'profile-read-only'
  | 'pnpm-unavailable'

export interface PluginUpdateCapability {
  supported: boolean
  profile?: string
  dependencySpec?: string
  reason?: PluginUpdateUnavailableReason
}

export interface PluginUpdateCheck extends PluginUpdateCapability {
  currentVersion: string
  latestVersion?: string
  updateAvailable: boolean
  checkedAt: string
}

export interface PluginUpdateResult {
  fromVersion: string
  toVersion: string
  profile: string
  restarting: true
  retryAfterMs: number
}

export class PluginUpdateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PluginUpdateError'
  }
}

interface ProfileInstall {
  profile: string
  profileDir: string
  installedDir: string
  dependencySpec: string
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

export interface RestartRequest {
  pid: number
  execPath: string
  args: readonly string[]
  cwd: string
  logPath: string
}

export interface PluginUpdateServiceOptions {
  packageRoot?: string
  profileDir?: string
  dshHome?: string
  argv?: readonly string[]
  now?: () => Date
  prepareRestart?: (request: RestartRequest) => void
  terminateCurrent?: () => void
  schedule?: (callback: () => void, delayMs: number) => void
}

interface PackageManifest {
  name?: unknown
  version?: unknown
  dependencies?: Record<string, string>
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: readonly (number | string)[]
}

const RESTART_HELPER = String.raw`
const { spawn } = require('node:child_process')
const payload = JSON.parse(Buffer.from(process.argv[1], 'base64url').toString('utf8'))
const deadline = Date.now() + 120000
const alive = () => {
  try { process.kill(payload.pid, 0); return true }
  catch (error) { return error && error.code === 'EPERM' }
}
const launch = () => {
  const child = spawn(payload.execPath, payload.args, {
    cwd: payload.cwd,
    env: process.env,
    stdio: 'inherit',
    detached: true,
    windowsHide: true,
  })
  child.once('error', error => {
    console.error('[dsh-vision-toolkit] replacement process failed:', error)
    process.exit(1)
  })
  child.once('spawn', () => {
    child.unref()
    process.exit(0)
  })
}
const wait = () => {
  if (!alive()) return launch()
  if (Date.now() >= deadline) process.exit(1)
  setTimeout(wait, 100)
}
wait()
`

function parseSemver(value: string): ParsedVersion | undefined {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value)
  if (match === null) return undefined
  const prerelease = match[4] === undefined
    ? []
    : match[4].split('.').map(part => /^\d+$/u.test(part) ? Number(part) : part)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  }
}

/** Compare two strict SemVer versions. */
export function compareVersions(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (a === undefined || b === undefined) return left.localeCompare(right)
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length === 0 ? 1 : -1
  }
  const count = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x.localeCompare(y)
  }
  return 0
}

function registryInstallSpec(spec: string): boolean {
  const normalized = spec.trim().toLowerCase()
  return normalized.length > 0
    && !/^[a-z][a-z0-9+.-]*:/u.test(normalized)
    && !normalized.includes('/')
    && !normalized.includes('\\')
}

function profileHint(argv: readonly string[]): string | undefined {
  if (argv[0] === 'web') return 'web'
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value?.startsWith('--profile=')) return value.slice('--profile='.length)
    if (value === '--profile') return argv[index + 1]
  }
  return undefined
}

async function jsonFile(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

async function sameRealPath(left: string, right: string): Promise<boolean> {
  try {
    return await realpath(left) === await realpath(right)
  } catch {
    return false
  }
}

function defaultPackageRoot(): string {
  return dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
}

function defaultDshHome(): string {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

function defaultPrepareRestart(request: RestartRequest): void {
  const payload = Buffer.from(JSON.stringify(request)).toString('base64url')
  mkdirSync(dirname(request.logPath), { recursive: true })
  const log = openSync(request.logPath, 'a')
  try {
    const helper = spawn(process.execPath, ['-e', RESTART_HELPER, payload], {
      cwd: request.cwd,
      env: process.env,
      stdio: ['ignore', log, log],
      detached: true,
      windowsHide: true,
    })
    if (helper.pid === undefined) throw new Error('restart helper did not publish a process id')
    helper.unref()
  } finally {
    closeSync(log)
  }
}

function defaultSchedule(callback: () => void, delayMs: number): void {
  const timer = setTimeout(callback, delayMs)
  timer.unref()
}

function publicCommandFailure(result: CommandResult, fallback: string): string {
  const detail = result.stderr.trim() || result.stdout.trim()
  if (result.timedOut) return `${fallback}: command timed out`
  if (detail.length === 0) return `${fallback}: pnpm exited with code ${String(result.exitCode)}`
  return `${fallback}: ${detail.slice(-4_000)}`
}

/** Profile-aware updater used by the same-origin Settings backend. */
export class VisionToolkitPluginUpdateService {
  private readonly packageRoot: string
  private readonly profileDir: string | undefined
  private readonly dshHome: string
  private readonly argv: readonly string[]
  private readonly now: () => Date
  private readonly prepareRestart: (request: RestartRequest) => void
  private readonly terminateCurrent: () => void
  private readonly schedule: (callback: () => void, delayMs: number) => void
  private locating?: Promise<ProfileInstall | PluginUpdateCapability>
  private updating = false

  constructor(
    private readonly ctx: Pick<Context, 'subprocess'>,
    private readonly currentVersion: string,
    options: PluginUpdateServiceOptions = {},
  ) {
    this.packageRoot = options.packageRoot ?? defaultPackageRoot()
    this.profileDir = options.profileDir
    this.dshHome = options.dshHome ?? defaultDshHome()
    this.argv = options.argv ?? process.argv.slice(2)
    this.now = options.now ?? (() => new Date())
    this.prepareRestart = options.prepareRestart ?? defaultPrepareRestart
    this.terminateCurrent = options.terminateCurrent ?? (() => { process.kill(process.pid, 'SIGTERM') })
    this.schedule = options.schedule ?? defaultSchedule
  }

  private async inspectProfile(
    profileDir: string,
    profile: string,
  ): Promise<ProfileInstall | PluginUpdateCapability | undefined> {
    const manifestPath = join(profileDir, 'package.json')
    const installedDir = join(profileDir, 'node_modules', ...VISION_TOOLKIT_PACKAGE.split('/'))
    let manifest: PackageManifest
    try {
      manifest = await jsonFile(manifestPath)
    } catch {
      return undefined
    }
    if (!(await sameRealPath(installedDir, this.packageRoot))) return undefined
    const dependencySpec = manifest.dependencies?.[VISION_TOOLKIT_PACKAGE]
    if (dependencySpec === undefined) {
      return { supported: false, profile, reason: 'not-direct-dependency' }
    }
    return { profile, profileDir, installedDir, dependencySpec }
  }

  private async locateProfile(): Promise<ProfileInstall | PluginUpdateCapability> {
    const hint = profileHint(this.argv)
    if (this.profileDir !== undefined) {
      const inspected = await this.inspectProfile(this.profileDir, hint ?? 'web')
      if (inspected === undefined) return { supported: false, reason: 'profile-not-found' }
      return inspected
    }

    const profilesDir = join(this.dshHome, 'profiles')
    const names = new Set<string>()
    if (hint !== undefined && hint.length > 0) names.add(hint)
    try {
      for (const entry of await readdir(profilesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) names.add(entry.name)
      }
    } catch {
      return { supported: false, reason: 'profile-not-found' }
    }

    let found: ProfileInstall | PluginUpdateCapability | undefined
    for (const name of names) {
      const inspected = await this.inspectProfile(join(profilesDir, name), name)
      if (inspected === undefined) continue
      if ('supported' in inspected) return inspected
      if (found !== undefined && hint === undefined) return { supported: false, reason: 'profile-not-found' }
      found = inspected
      if (name === hint) break
    }
    return found ?? { supported: false, reason: 'profile-not-found' }
  }

  private async profile(): Promise<ProfileInstall | PluginUpdateCapability> {
    return await (this.locating ??= this.locateProfile())
  }

  /** Report whether the current installation can be safely replaced in place. */
  async capability(): Promise<PluginUpdateCapability> {
    const profile = await this.profile()
    if ('supported' in profile) return profile
    if (!registryInstallSpec(profile.dependencySpec)) {
      return {
        supported: false,
        profile: profile.profile,
        dependencySpec: profile.dependencySpec,
        reason: 'unsupported-install-source',
      }
    }
    try {
      await access(join(profile.profileDir, 'package.json'), fsConstants.W_OK)
    } catch {
      return {
        supported: false,
        profile: profile.profile,
        dependencySpec: profile.dependencySpec,
        reason: 'profile-read-only',
      }
    }
    try {
      await this.ctx.subprocess.resolveExecutable('pnpm')
    } catch {
      return {
        supported: false,
        profile: profile.profile,
        dependencySpec: profile.dependencySpec,
        reason: 'pnpm-unavailable',
      }
    }
    return { supported: true, profile: profile.profile, dependencySpec: profile.dependencySpec }
  }

  private async runPnpm(args: readonly string[], timeoutMs: number): Promise<CommandResult> {
    const profile = await this.profile()
    if ('supported' in profile) throw new PluginUpdateError('update-unavailable', 'Plugin update is unavailable for this installation')
    const pnpm = await this.ctx.subprocess.resolveExecutable('pnpm')
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      const handle = this.ctx.subprocess.spawn({
        argv: [pnpm, ...args],
        cwd: profile.profileDir,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: COMMAND_OUTPUT_BYTES },
          stderr: { maxBytes: COMMAND_OUTPUT_BYTES },
        },
        graceMs: 5_000,
        signal: controller.signal,
      })
      const outcome = await handle.done
      return {
        stdout: handle.collected.stdout?.readFrom(0).text ?? '',
        stderr: handle.collected.stderr?.readFrom(0).text ?? '',
        exitCode: outcome.exitCode,
        timedOut,
      }
    } catch (error) {
      if (timedOut) return { stdout: '', stderr: '', exitCode: null, timedOut: true }
      throw new PluginUpdateError('pnpm-failed', 'Could not start pnpm', { cause: error })
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Query the configured npm registry without mutating the profile. */
  async check(): Promise<PluginUpdateCheck> {
    const capability = await this.capability()
    if (!capability.supported) {
      return {
        ...capability,
        currentVersion: this.currentVersion,
        updateAvailable: false,
        checkedAt: this.now().toISOString(),
      }
    }
    const result = await this.runPnpm(['view', VISION_TOOLKIT_PACKAGE, 'version', '--json'], CHECK_TIMEOUT_MS)
    if (result.exitCode !== 0) {
      throw new PluginUpdateError('update-check-failed', publicCommandFailure(result, 'Could not check the npm registry'))
    }
    let latestVersion: string
    try {
      const parsed = JSON.parse(result.stdout.trim()) as unknown
      if (typeof parsed !== 'string' || parseSemver(parsed) === undefined) throw new Error('invalid version')
      latestVersion = parsed
    } catch (error) {
      throw new PluginUpdateError('update-check-failed', 'The npm registry returned an invalid plugin version', { cause: error })
    }
    return {
      ...capability,
      currentVersion: this.currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, this.currentVersion) > 0,
      checkedAt: this.now().toISOString(),
    }
  }

  /** Install the currently published version, then restart this DSH process. */
  async installAndRestart(expectedVersion: string): Promise<PluginUpdateResult> {
    if (this.updating) throw new PluginUpdateError('update-in-progress', 'A plugin update is already in progress')
    this.updating = true
    try {
      const check = await this.check()
      if (!check.supported || check.latestVersion === undefined) {
        throw new PluginUpdateError('update-unavailable', 'Plugin update is unavailable for this installation')
      }
      if (check.latestVersion !== expectedVersion) {
        throw new PluginUpdateError(
          'update-stale',
          `The latest version changed from ${expectedVersion} to ${check.latestVersion}; check again before updating`,
        )
      }
      if (!check.updateAvailable) {
        throw new PluginUpdateError('already-current', `Plugin ${this.currentVersion} is already up to date`)
      }
      const profile = await this.profile()
      if ('supported' in profile) throw new PluginUpdateError('update-unavailable', 'Plugin update is unavailable for this installation')
      const result = await this.runPnpm([
        'add', `${VISION_TOOLKIT_PACKAGE}@${expectedVersion}`, '--save-exact', '--yes', '--reporter=append-only',
      ], UPDATE_TIMEOUT_MS)
      if (result.exitCode !== 0) {
        throw new PluginUpdateError('update-failed', publicCommandFailure(result, 'Plugin update failed'))
      }
      let installedVersion: string
      try {
        const installed = await jsonFile(join(profile.installedDir, 'package.json'))
        if (typeof installed.version !== 'string') throw new Error('missing version')
        installedVersion = installed.version
      } catch (error) {
        throw new PluginUpdateError('update-verify-failed', 'The updated package version could not be verified', { cause: error })
      }
      if (installedVersion !== expectedVersion) {
        throw new PluginUpdateError(
          'update-verify-failed',
          `pnpm completed, but installed ${installedVersion} instead of ${expectedVersion}`,
        )
      }

      try {
        this.prepareRestart({
          pid: process.pid,
          execPath: process.execPath,
          args: [...process.execArgv, ...process.argv.slice(1)],
          cwd: process.cwd(),
          logPath: join(this.dshHome, 'logs', 'vision-toolkit-restart.log'),
        })
      } catch (error) {
        throw new PluginUpdateError(
          'restart-failed',
          `Plugin ${installedVersion} was installed, but automatic restart could not be prepared`,
          { cause: error },
        )
      }
      this.schedule(this.terminateCurrent, RESTART_DELAY_MS)
      return {
        fromVersion: this.currentVersion,
        toVersion: installedVersion,
        profile: profile.profile,
        restarting: true,
        retryAfterMs: RESTART_RETRY_AFTER_MS,
      }
    } catch (error) {
      this.updating = false
      throw error
    }
  }
}
