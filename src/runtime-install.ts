/**
 * Reproducible upstream runtime preparation. Managed mode uses the packaged,
 * hash-verified agent-vision-toolkit snapshot plus an atomic isolated Python
 * environment; external mode accepts only the pinned clean Git commit or an
 * exact exported copy of the packaged snapshot.
 * @module dsh-vision-toolkit/runtime-install
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { createWriteStream, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { x as extractTar } from 'tar'
import { EnvHttpProxyAgent } from 'undici'
import { request as undiciRequest } from 'undici'
import type { ResolvedVisionToolkitConfig } from './config.ts'
import { VisionToolkitError } from './errors.ts'
import { UPSTREAM_COMMIT, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from './version.ts'

/** One executable plus fixed prefix arguments (for example Windows `py -3`). */
export interface RuntimeCommand {
  program: string
  prefix: string[]
  display: string
}

/** Prepared source and interpreter facts consumed by the upstream adapter. */
export interface PreparedUpstreamRuntime {
  source: 'managed' | 'external'
  root: string
  python: RuntimeCommand
  cleanHome: string
  pythonVersion: string
  dependencies: Record<string, string>
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

interface UpstreamManifest {
  schemaVersion: number
  repository: string
  version: string
  commit: string
  contentSha256: string
  files: Array<{ path: string; bytes: number; sha256: string }>
}

interface RuntimeMarker {
  schemaVersion: 1
  upstreamCommit: string
  upstreamContentSha256: string
  requirementsSha256: string
  pythonVersion: string
  dependencies: Record<string, string>
  manager: 'uv' | 'venv-pip'
}

const PACKAGE_ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const BUNDLED_ROOT = join(PACKAGE_ROOT, 'vendor', 'agent-vision-toolkit')
const MANIFEST_PATH = join(BUNDLED_ROOT, 'UPSTREAM_MANIFEST.json')
const REQUIREMENTS_PATH = join(PACKAGE_ROOT, 'runtime', 'requirements.lock')
const PREPARE_TIMEOUT_MS = 10 * 60 * 1000
const PYPI_MIRROR_BASE_URL = 'https://mirrors.cloud.tencent.com/pypi/simple'
const PROBE_TIMEOUT_MS = 30_000
const LOCK_STALE_MS = 15 * 60 * 1000
const LOCK_HEARTBEAT_MS = 5_000
const WINDOWS_FILE_RETRY_ATTEMPTS = 5
const WINDOWS_FILE_RETRY_DELAY_MS = 250
const LEGACY_RUNTIME_GC_STALE_MS = 24 * 60 * 60 * 1000

/** Absolute root of the packaged upstream snapshot. */
export function bundledUpstreamRoot(): string {
  return BUNDLED_ROOT
}

/** Convert one command into a user-facing executable string. */
export function displayCommand(command: RuntimeCommand): string {
  return [command.program, ...command.prefix].join(' ')
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Windows Defender/antivirus real-time scanning briefly locks freshly written
 * Python DLLs, so recursive removal and directory replacement can fail with
 * EBUSY/EPERM immediately after installation. Retry those transient Windows
 * errors before surfacing them; non-Windows platforms pass through unchanged.
 */
export async function withWindowsTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= WINDOWS_FILE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
      const transient = process.platform === 'win32' && (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')
      if (!transient) break
      if (attempt < WINDOWS_FILE_RETRY_ATTEMPTS) {
        await new Promise(resolveWait => setTimeout(resolveWait, WINDOWS_FILE_RETRY_DELAY_MS * attempt))
      }
    }
  }
  throw lastError
}

/**
 * Best-effort removal used after the primary runtime path has already
 * succeeded or failed. Transient Windows locks must not turn a usable runtime
 * into an error, but leaving the directory behind should still be audible.
 */
export async function ignoreCleanupFailure(ctx: Context, label: string, path: string): Promise<void> {
  try {
    await withWindowsTransientRetry(() => rm(path, { recursive: true, force: true }))
  } catch (error) {
    ctx.logger.warn(
      'dsh-vision-toolkit: %s cleanup failed: %s',
      label,
      error instanceof Error ? error.message : String(error),
    )
  }
}

type RuntimeGarbageKind = 'managed runtime staging' | 'managed runtime quarantine' | 'bundled Python staging'

interface RuntimeGarbageCandidate {
  kind: RuntimeGarbageKind
  lockName?: string
  lockToken?: string
  minimumAgeMs?: number
  createdAtMs?: number
  observationMarker?: string
}

function runtimeGarbageLockToken(lockBase: string): string {
  return sha256(lockBase).slice(0, 12)
}

function managedRuntimeGarbage(name: string): RuntimeGarbageCandidate | undefined {
  if (name.startsWith('.prepare-')) {
    const current = /^\.prepare-([a-f0-9]{12})-[^/]{6}$/.exec(name)
    return { kind: 'managed runtime staging', ...(current === null ? {} : { lockToken: current[1] }) }
  }
  const replaced = name.indexOf('.replaced-')
  if (replaced > 0) {
    const stamped = /^(\d{13})-/.exec(name.slice(replaced + '.replaced-'.length))
    return {
      kind: 'managed runtime quarantine',
      lockName: `${name.slice(0, replaced)}.lock`,
      minimumAgeMs: LEGACY_RUNTIME_GC_STALE_MS,
      ...(stamped === null
        ? { observationMarker: '.dsh-vision-toolkit-gc-observed' }
        : { createdAtMs: Number(stamped[1]) }),
    }
  }
  return undefined
}

function bundledPythonGarbage(name: string): RuntimeGarbageCandidate | undefined {
  if (!name.startsWith('.python-bootstrap-')) return undefined
  const current = /^\.python-bootstrap-([a-f0-9]{12})-[^/]{6}$/.exec(name)
  return { kind: 'bundled Python staging', ...(current === null ? {} : { lockToken: current[1] }) }
}

async function runtimeLockIsActive(lockPath: string, now: number): Promise<boolean> {
  try {
    const info = await stat(lockPath)
    return now - info.mtimeMs <= LOCK_STALE_MS
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    return true
  }
}

async function garbageCollectDirectory(
  ctx: Context,
  parent: string,
  classify: (name: string) => RuntimeGarbageCandidate | undefined,
  now: number,
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(parent, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    ctx.logger.warn(
      'dsh-vision-toolkit: runtime garbage collection scan failed for %s: %s',
      parent,
      error instanceof Error ? error.message : String(error),
    )
    return
  }
  let activeLockTokens: Set<string> | undefined
  const getActiveLockTokens = async (): Promise<Set<string>> => {
    if (activeLockTokens !== undefined) return activeLockTokens
    activeLockTokens = new Set<string>()
    for (const lock of entries) {
      if (
        lock.isDirectory()
        && lock.name.endsWith('.lock')
        && await runtimeLockIsActive(join(parent, lock.name), now)
      ) {
        activeLockTokens.add(runtimeGarbageLockToken(lock.name.slice(0, -'.lock'.length)))
      }
    }
    return activeLockTokens
  }
  let legacyCollectionSafe: boolean | undefined
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = classify(entry.name)
    if (candidate === undefined) continue
    const path = join(parent, entry.name)
    if (candidate.lockName !== undefined) {
      if (await runtimeLockIsActive(join(parent, candidate.lockName), now)) continue
    } else if (candidate.lockToken !== undefined) {
      if ((await getActiveLockTokens()).has(candidate.lockToken)) continue
    } else {
      if (legacyCollectionSafe === undefined) {
        legacyCollectionSafe = (await getActiveLockTokens()).size === 0
      }
      if (!legacyCollectionSafe) continue
      try {
        const info = await stat(path)
        if (now - info.mtimeMs <= LEGACY_RUNTIME_GC_STALE_MS) continue
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        ctx.logger.warn(
          'dsh-vision-toolkit: runtime garbage collection inspection failed for %s: %s',
          path,
          error instanceof Error ? error.message : String(error),
        )
        continue
      }
    }
    if (candidate.minimumAgeMs !== undefined) {
      let createdAt = candidate.createdAtMs
      if (createdAt === undefined && candidate.observationMarker !== undefined) {
        const marker = join(path, candidate.observationMarker)
        try {
          createdAt = (await stat(marker)).mtimeMs
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            await writeFile(marker, `${now}\n`, { flag: 'wx' }).catch(() => {})
          }
          continue
        }
      }
      if (createdAt === undefined) {
        try {
          createdAt = (await stat(path)).mtimeMs
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          ctx.logger.warn(
            'dsh-vision-toolkit: runtime garbage collection inspection failed for %s: %s',
            path,
            error instanceof Error ? error.message : String(error),
          )
          continue
        }
      }
      if (now - createdAt <= candidate.minimumAgeMs) continue
    }
    await ignoreCleanupFailure(ctx, `stale ${candidate.kind}`, path)
  }
}

/**
 * Opportunistically remove abandoned runtime staging and quarantine trees.
 * Current names encode their owning runtime lock, so live preparation is
 * skipped. Quarantines retain a 24-hour recovery window; legacy names use the
 * same grace period and are collected only when no runtime lock is active
 * because they cannot be associated with a specific lock.
 */
export async function garbageCollectRuntimeCache(
  ctx: Context,
  stateRoot: string,
  now: number = Date.now(),
): Promise<void> {
  await garbageCollectDirectory(ctx, join(stateRoot, 'python'), managedRuntimeGarbage, now)
  await garbageCollectDirectory(ctx, join(stateRoot, 'python-bootstrap'), bundledPythonGarbage, now)
}

export function isolatedPythonEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: home,
    PYTHONHOME: undefined,
    PYTHONPATH: undefined,
    VIRTUAL_ENV: undefined,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
    PYTHONUTF8: '1',
  }
}

async function runCollected(
  ctx: Context,
  argv: readonly string[],
  cwd: string,
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? PROBE_TIMEOUT_MS)
  try {
    const handle = ctx.subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 256 * 1024 },
        stderr: { maxBytes: 256 * 1024 },
      },
      graceMs: 2000,
      signal: controller.signal,
      ...(options.env === undefined ? {} : { env: options.env }),
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
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function installDependenciesWithFallback(
  ctx: Context,
  argv: readonly string[],
  stateRoot: string,
  env: NodeJS.ProcessEnv,
  label: string,
): Promise<void> {
  let lastResult: CommandResult | undefined
  for (const indexUrl of [PYPI_MIRROR_BASE_URL, undefined]) {
    const indexArgs = indexUrl === undefined ? [] : ['--index-url', indexUrl]
    const result = await runCollected(ctx, [...argv, ...indexArgs], stateRoot, { timeoutMs: PREPARE_TIMEOUT_MS, env })
    if (result.exitCode === 0 && !result.timedOut) return
    lastResult = result
  }
  throw new VisionToolkitError(
    'runtime',
    `${label} failed to install managed runtime dependencies: ${(lastResult?.stderr ?? '').trim()}`,
  )
}

async function readManifest(path = MANIFEST_PATH): Promise<UpstreamManifest> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new VisionToolkitError('runtime', `upstream manifest is unreadable: ${path}`, { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new VisionToolkitError('runtime', `upstream manifest is not an object: ${path}`)
  }
  const manifest = parsed as Partial<UpstreamManifest>
  if (
    manifest.schemaVersion !== 1
    || manifest.repository !== UPSTREAM_REPOSITORY
    || manifest.version !== UPSTREAM_VERSION
    || manifest.commit !== UPSTREAM_COMMIT
    || !/^[a-f0-9]{64}$/.test(manifest.contentSha256 ?? '')
    || typeof manifest.contentSha256 !== 'string'
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0
  ) {
    throw new VisionToolkitError('runtime', `upstream manifest identity does not match the packaged pin: ${path}`)
  }
  const seen = new Set<string>()
  let previous = ''
  for (const entry of manifest.files) {
    if (
      typeof entry !== 'object'
      || entry === null
      || typeof entry.path !== 'string'
      || entry.path.length === 0
      || entry.path.includes('\\')
      || entry.path.startsWith('/')
      || entry.path.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')
      || !Number.isInteger(entry.bytes)
      || entry.bytes < 0
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || seen.has(entry.path)
      || (previous.length > 0 && previous >= entry.path)
    ) {
      throw new VisionToolkitError('runtime', `upstream manifest contains an invalid file entry: ${path}`)
    }
    seen.add(entry.path)
    previous = entry.path
  }
  return manifest as UpstreamManifest
}

/** Verify every packaged upstream file against the committed content manifest. */
export async function verifyBundledUpstream(): Promise<UpstreamManifest> {
  const manifest = await readManifest()
  const rows: string[] = []
  for (const entry of manifest.files) {
    const path = join(BUNDLED_ROOT, ...entry.path.split('/'))
    let bytes: Buffer
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new VisionToolkitError('runtime', `packaged upstream entry is not a regular file: ${entry.path}`)
      }
      bytes = await readFile(path)
    } catch (error) {
      if (error instanceof VisionToolkitError) throw error
      throw new VisionToolkitError('runtime', `packaged upstream file is missing: ${entry.path}`, { cause: error })
    }
    const digest = sha256(bytes)
    if (bytes.length !== entry.bytes || digest !== entry.sha256) {
      throw new VisionToolkitError('runtime', `packaged upstream file failed its hash check: ${entry.path}`)
    }
    rows.push(`${entry.path}\0${digest}\n`)
  }
  if (sha256(rows.join('')) !== manifest.contentSha256) {
    throw new VisionToolkitError('runtime', 'packaged upstream aggregate hash does not match its manifest')
  }
  return manifest
}

async function pythonMetadata(
  ctx: Context,
  command: RuntimeCommand,
  cwd: string,
): Promise<{ version: string; major: number; minor: number } | undefined> {
  const script = 'import json,sys; print(json.dumps({"version":sys.version.split()[0],"major":sys.version_info[0],"minor":sys.version_info[1]}))'
  let result: CommandResult
  try {
    result = await runCollected(ctx, [command.program, ...command.prefix, '-c', script], cwd, {
      env: isolatedPythonEnvironment(cwd),
    })
  } catch {
    return undefined
  }
  if (result.exitCode !== 0 || result.timedOut) return undefined
  try {
    const parsed = JSON.parse(result.stdout) as { version?: unknown; major?: unknown; minor?: unknown }
    if (typeof parsed.version !== 'string' || typeof parsed.major !== 'number' || typeof parsed.minor !== 'number') {
      return undefined
    }
    return { version: parsed.version, major: parsed.major, minor: parsed.minor }
  } catch {
    return undefined
  }
}

interface PythonBootstrapArtifact {
  url: string
  sha256: string
  size: number
}

interface PythonBootstrapManifest {
  schemaVersion: 1
  pythonVersion: string
  buildTag: string
  /** Optional domestic mirror base that replaces the GitHub download prefix. */
  mirrorBaseUrl?: string
  artifacts: Record<string, PythonBootstrapArtifact>
}

const PYTHON_BOOTSTRAP_MANIFEST_PATH = join(PACKAGE_ROOT, 'assets', 'python-bootstrap.json')
const GITHUB_PYTHON_DOWNLOAD_PREFIX = 'https://github.com/astral-sh/python-build-standalone/releases/download'
const PYTHON_MIRROR_BASE_URL = 'https://dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com'
const PYTHON_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const PYTHON_DOWNLOAD_ATTEMPTS = 3

async function readPythonBootstrapManifest(): Promise<PythonBootstrapManifest> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(PYTHON_BOOTSTRAP_MANIFEST_PATH, 'utf8'))
  } catch (error) {
    throw new VisionToolkitError('runtime', `python bootstrap manifest is unreadable: ${PYTHON_BOOTSTRAP_MANIFEST_PATH}`, { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new VisionToolkitError('runtime', 'python bootstrap manifest is not an object')
  }
  const manifest = parsed as Partial<PythonBootstrapManifest>
  if (
    manifest.schemaVersion !== 1
    || typeof manifest.pythonVersion !== 'string'
    || !/^3\.\d+\.\d+$/u.test(manifest.pythonVersion)
    || typeof manifest.buildTag !== 'string'
    || !/^\d{8}$/u.test(manifest.buildTag)
    || (manifest.mirrorBaseUrl !== undefined && manifest.mirrorBaseUrl !== PYTHON_MIRROR_BASE_URL)
    || typeof manifest.artifacts !== 'object'
    || manifest.artifacts === null
  ) {
    throw new VisionToolkitError('runtime', 'python bootstrap manifest is invalid')
  }
  for (const [target, artifact] of Object.entries(manifest.artifacts)) {
    if (
      typeof artifact !== 'object'
      || artifact === null
      || typeof artifact.url !== 'string'
      || !artifact.url.startsWith(`${GITHUB_PYTHON_DOWNLOAD_PREFIX}/`)
      || typeof artifact.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/u.test(artifact.sha256)
      || !Number.isInteger(artifact.size)
      || artifact.size <= 0
    ) {
      throw new VisionToolkitError('runtime', `python bootstrap manifest has an invalid artifact: ${target}`)
    }
  }
  return manifest as PythonBootstrapManifest
}

/** Map Node platform/arch to the pinned artifact name, including musl Linux. */
export function pythonBootstrapTarget(platform: string, arch: string, musl: boolean): string {
  return platform === 'linux' && musl ? `${platform}-${arch}-musl` : `${platform}-${arch}`
}

async function runningMusl(): Promise<boolean> {
  if (process.platform !== 'linux') return false
  try {
    await access(join('/', 'etc', 'alpine-release'))
    return true
  } catch {
    // Fall through to the loader-name probe.
  }
  const loader = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  try {
    await access(join('/', 'lib', `ld-musl-${loader}.so.1`))
    return true
  } catch {
    return false
  }
}

interface DownloadResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: NodeJS.ReadableStream
  close: () => Promise<void>
}

type DownloadRequest = (url: string, signal: AbortSignal) => Promise<DownloadResponse>

const DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com',
])

async function defaultDownloadRequest(url: string, signal: AbortSignal): Promise<DownloadResponse> {
  const dispatcher = new EnvHttpProxyAgent()
  let current = url
  try {
    for (let redirects = 0; ; redirects++) {
      const host = new URL(current).hostname
      if (!DOWNLOAD_HOSTS.has(host)) throw new Error(`download redirected outside the allowlist: ${host}`)
      const response = await undiciRequest(current, {
        dispatcher,
        signal,
        headers: { 'user-agent': 'dsh-vision-toolkit' },
      })
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const location = response.headers.location
        await response.body.dump().catch(() => {})
        if (typeof location !== 'string' || location.length === 0 || redirects >= 5) {
          throw new Error('download redirected too many times or without a Location header')
        }
        current = new URL(location, current).toString()
        continue
      }
      return {
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
        close: () => dispatcher.close().catch(() => {}),
      }
    }
  } catch (error) {
    await dispatcher.close().catch(() => {})
    throw error
  }
}

async function downloadBundledPythonOnce(
  url: string,
  artifact: PythonBootstrapArtifact,
  destination: string,
  requestImpl: DownloadRequest = defaultDownloadRequest,
): Promise<void> {
  const signal = AbortSignal.timeout(PYTHON_DOWNLOAD_TIMEOUT_MS)
  let response: DownloadResponse
  try {
    response = await requestImpl(url, signal)
  } catch (error) {
    throw new Error(`download request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    if (response.statusCode !== 200) throw new Error(`download returned HTTP ${response.statusCode}`)
    const hash = createHash('sha256')
    let bytes = 0
    const hasher = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk as Buffer)
        bytes += (chunk as Buffer).length
        callback(null, chunk)
      },
    })
    await pipeline(response.body, hasher, createWriteStream(destination))
    if (bytes !== artifact.size) throw new Error(`size mismatch: expected ${artifact.size}, received ${bytes}`)
    if (hash.digest('hex') !== artifact.sha256) throw new Error('sha256 mismatch')
  } finally {
    await response.close()
  }
}

async function downloadBundledPython(
  manifest: PythonBootstrapManifest,
  artifact: PythonBootstrapArtifact,
  destination: string,
  requestImpl: DownloadRequest,
): Promise<void> {
  const sources = [
    ...(manifest.mirrorBaseUrl === undefined
      ? []
      : [artifact.url.replace(GITHUB_PYTHON_DOWNLOAD_PREFIX, manifest.mirrorBaseUrl)]),
    artifact.url,
  ]
  let lastError: unknown
  for (let attempt = 0; attempt < PYTHON_DOWNLOAD_ATTEMPTS; attempt++) {
    const source = sources[Math.min(attempt, sources.length - 1)] ?? artifact.url
    try {
      await downloadBundledPythonOnce(source, artifact, destination, requestImpl)
      return
    } catch (error) {
      lastError = error
      if (attempt + 1 < PYTHON_DOWNLOAD_ATTEMPTS) {
        await new Promise(resolveWait => setTimeout(resolveWait, 500 * 2 ** attempt))
      }
    }
  }
  throw lastError
}

/**
 * Cross-process directory lock with a stale-lock timeout and heartbeat,
 * matching the managed-runtime lock semantics.
 */
async function withDirectoryLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const owner = randomUUID()
  let acquired = false
  await mkdir(dirname(lockPath), { recursive: true })
  try {
    await mkdir(lockPath, { recursive: false })
    acquired = true
    await writeFile(join(lockPath, 'owner'), `${owner}\n`, { flag: 'wx' })
  } catch (error) {
    if (acquired) {
      await withWindowsTransientRetry(() => rm(lockPath, { recursive: true, force: true })).catch(() => {})
      throw error
    }
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const started = Date.now()
    while (Date.now() - started < PREPARE_TIMEOUT_MS) {
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await withWindowsTransientRetry(() => rm(lockPath, { recursive: true, force: true }))
          return withDirectoryLock(lockPath, fn)
        }
      } catch {
        return withDirectoryLock(lockPath, fn)
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 250))
    }
    throw new VisionToolkitError('runtime', 'timed out waiting for another process to prepare the bundled Python')
  }
  const heartbeat = setInterval(() => {
    const now = new Date()
    void utimes(lockPath, now, now).catch(() => {})
  }, LOCK_HEARTBEAT_MS)
  heartbeat.unref()
  try {
    return await fn()
  } finally {
    clearInterval(heartbeat)
    try {
      if ((await readFile(join(lockPath, 'owner'), 'utf8')).trim() === owner) {
        await withWindowsTransientRetry(() => rm(lockPath, { recursive: true, force: true }))
      }
    } catch {
      // The lock was already removed or replaced.
    }
  }
}

export async function acquireBundledPython(
  ctx: Context,
  stateRoot: string,
  cwd: string,
  manifestOverride?: PythonBootstrapManifest,
  requestImpl?: DownloadRequest,
): Promise<{ command: RuntimeCommand; version: string }> {
  const manifest = manifestOverride ?? await readPythonBootstrapManifest()
  const target = pythonBootstrapTarget(process.platform, process.arch, await runningMusl())
  const artifact = manifest.artifacts[target]
  if (artifact === undefined) {
    throw new VisionToolkitError(
      'runtime',
      `no bundled Python ${manifest.pythonVersion} artifact for ${target}; install Python 3.11+ or configure runtime.python`,
    )
  }
  const root = join(stateRoot, 'python-bootstrap', `${manifest.pythonVersion}-${target}`)
  const interpreter = process.platform === 'win32' ? join(root, 'python.exe') : join(root, 'bin', 'python3')
  const command: RuntimeCommand = { program: interpreter, prefix: [], display: interpreter }
  const cached = await pythonMetadata(ctx, command, cwd)
  if (cached !== undefined) return { command, version: cached.version }
  await withDirectoryLock(`${root}.lock`, async () => {
    const ready = await pythonMetadata(ctx, command, cwd)
    if (ready !== undefined) return
    const parent = dirname(root)
    await mkdir(parent, { recursive: true })
    await withWindowsTransientRetry(() => rm(root, { recursive: true, force: true }))
    const work = await mkdtemp(join(parent, `.python-bootstrap-${runtimeGarbageLockToken(basename(root))}-`))
    try {
      const archive = join(work, 'python.tar.gz')
      const extractDir = join(work, 'extract')
      await mkdir(extractDir, { recursive: true })
      try {
        await downloadBundledPython(manifest, artifact, archive, requestImpl ?? defaultDownloadRequest)
      } catch (error) {
        throw new VisionToolkitError(
          'runtime',
          `bundled Python ${manifest.pythonVersion} could not be downloaded for ${target} (${error instanceof Error ? error.message : String(error)}); install Python 3.11+ or configure runtime.python`,
          { cause: error },
        )
      }
      try {
        await extractTar({ file: archive, cwd: extractDir, strip: 1 })
      } catch (error) {
        throw new VisionToolkitError(
          'runtime',
          `bundled Python ${manifest.pythonVersion} could not be extracted for ${target}`,
          { cause: error },
        )
      }
      const extractedInterpreter = process.platform === 'win32'
        ? join(extractDir, 'python.exe')
        : join(extractDir, 'bin', 'python3')
      try {
        await access(extractedInterpreter)
      } catch (error) {
        throw new VisionToolkitError(
          'runtime',
          `bundled Python ${manifest.pythonVersion} for ${target} is missing its interpreter`,
          { cause: error },
        )
      }
      if (process.platform !== 'win32') await chmod(extractedInterpreter, 0o755)
      await withWindowsTransientRetry(() => rename(extractDir, root))
    } finally {
      await ignoreCleanupFailure(ctx, 'bundled Python staging', work)
    }
  })
  const metadata = await pythonMetadata(ctx, command, cwd)
  if (metadata === undefined) {
    throw new VisionToolkitError('runtime', 'bundled Python did not start after extraction')
  }
  return { command, version: metadata.version }
}

export async function resolveBootstrapPython(
  ctx: Context,
  configured: string | undefined,
  cwd: string,
  manifestOverride?: PythonBootstrapManifest,
  requestImpl?: DownloadRequest,
): Promise<{ command: RuntimeCommand; version: string; major: number; minor: number }> {
  const candidates: RuntimeCommand[] = configured === undefined
    ? process.platform === 'win32'
      ? [
        { program: 'python', prefix: [], display: 'python' },
        { program: 'py', prefix: ['-3'], display: 'py -3' },
        { program: 'python3', prefix: [], display: 'python3' },
      ]
      : [
        { program: 'python3', prefix: [], display: 'python3' },
        { program: 'python', prefix: [], display: 'python' },
      ]
    : [{ program: configured, prefix: [], display: configured }]
  for (const command of candidates) {
    const metadata = await pythonMetadata(ctx, command, cwd)
    if (metadata !== undefined && (metadata.major > 3 || metadata.major === 3 && metadata.minor >= 11)) {
      return { command, ...metadata }
    }
  }
  if (configured !== undefined) {
    throw new VisionToolkitError('runtime', `vision-toolkit requires Python 3.11 or newer: ${configured}`)
  }
  try {
    const stateRoot = visionToolkitStateRoot()
    await mkdir(stateRoot, { recursive: true })
    await garbageCollectRuntimeCache(ctx, stateRoot)
    const bundled = await acquireBundledPython(ctx, stateRoot, cwd, manifestOverride, requestImpl)
    return {
      command: bundled.command,
      version: bundled.version,
      major: Number.parseInt(bundled.version.split('.')[0] ?? '', 10),
      minor: Number.parseInt(bundled.version.split('.')[1] ?? '', 10),
    }
  } catch (error) {
    if (error instanceof VisionToolkitError) throw error
    throw new VisionToolkitError(
      'runtime',
      'vision-toolkit requires Python 3.11 or newer; tried python3, python, and the Windows py launcher, and automatic bundled-Python preparation failed',
      { cause: error },
    )
  }
}

/** Persistent per-DSH-home cache root shared by runtime and Web support files. */
export function visionToolkitStateRoot(): string {
  const dshHome = process.env.DSH_HOME?.trim()
  const base = dshHome === undefined || dshHome.length === 0 ? join(homedir(), '.dsh') : resolve(dshHome)
  return join(base, 'cache', 'dsh-vision-toolkit')
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

function venvPython(root: string): string {
  return process.platform === 'win32' ? join(root, 'Scripts', 'python.exe') : join(root, 'bin', 'python')
}

/**
 * Rewrite a staged venv's `pyvenv.cfg` `home`/`executable` to point at a given
 * base directory (the app execution alias directory for the Microsoft Store
 * Python). Pure helper so the transformation is testable cross-platform.
 */
export function rewriteVenvConfig(cfg: string, homeDir: string): string {
  return cfg
    .replace(/^home = .*$/m, `home = ${homeDir}`)
    .replace(/^executable = .*$/m, `executable = ${homeDir}\\python.exe`)
}

/**
 * Build the Microsoft Store probe environment while preserving Python-variable
 * tombstones; only the user-directory variables must fall back to the host.
 */
export function storePythonProbeEnvironment(installEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(installEnv).filter(([key]) => key !== 'HOME' && key !== 'USERPROFILE' && key !== 'LOCALAPPDATA'),
  )
}

/**
 * Windows-only workaround for the Microsoft Store Python. `python -m venv`
 * records `home = C:\Program Files\WindowsApps\...` in the new venv, but the
 * venv launcher (venvlauncher.exe) cannot CreateProcess that `python.exe`
 * directly — the AppModel package execution restriction denies it (error 5) —
 * so the venv's pip bootstrap exits 101. Rewrite the staged venv's pyvenv.cfg
 * to the app execution alias directory, whose `python.exe` is launchable
 * through Store activation.
 */
async function rewriteStorePythonVenvHome(
  ctx: Context,
  bootstrap: { command: RuntimeCommand },
  staging: string,
  installEnv: NodeJS.ProcessEnv,
  cwd: string,
): Promise<void> {
  if (process.platform !== 'win32') return
  // The HOME/USERPROFILE/LOCALAPPDATA overrides make the Store alias resolve to
  // the real Program Files\WindowsApps path; without them sys.executable points
  // back at the alias directory that venvlauncher can launch.
  const probeEnv = storePythonProbeEnvironment(installEnv)
  const probe = await runCollected(
    ctx,
    [bootstrap.command.program, ...bootstrap.command.prefix, '-c', 'import os,sys; print(os.path.dirname(sys.executable))'],
    cwd,
    { env: probeEnv },
  )
  if (probe.exitCode !== 0 || probe.timedOut) return
  const aliasDir = probe.stdout.trim().split(/\r?\n/)[0]
  if (aliasDir === undefined || aliasDir.length === 0) return
  const cfgPath = join(staging, 'pyvenv.cfg')
  let cfg: string
  try {
    cfg = await readFile(cfgPath, 'utf8')
  } catch {
    return
  }
  // Only touch the known-broken layout; other interpreters are left untouched.
  if (!/^home = .*Program Files\\WindowsApps.*$/m.test(cfg)) return
  await writeFile(cfgPath, rewriteVenvConfig(cfg, aliasDir))
}

async function dependencyVersions(
  ctx: Context,
  python: RuntimeCommand,
  cwd: string,
): Promise<Record<string, string>> {
  const script = [
    'import json',
    'from importlib.metadata import version',
    'import PIL',
    'import numpy',
    'import vtracer',
    'print(json.dumps({"pillow":version("pillow"),"numpy":version("numpy"),"vtracer":version("vtracer")}))',
  ].join(';')
  let result: CommandResult
  try {
    result = await runCollected(ctx, [python.program, ...python.prefix, '-c', script], cwd, {
      env: isolatedPythonEnvironment(cwd),
    })
  } catch (error) {
    throw new VisionToolkitError('runtime', `failed to start ${displayCommand(python)}`, { cause: error })
  }
  if (result.exitCode !== 0 || result.timedOut) {
    throw new VisionToolkitError(
      'runtime',
      `vision-toolkit Python dependencies are unavailable in ${displayCommand(python)}: ${result.stderr.trim() || 'probe failed'}`,
    )
  }
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    if (Object.values(parsed).some(value => typeof value !== 'string')) throw new Error('non-string dependency version')
    return parsed as Record<string, string>
  } catch (error) {
    throw new VisionToolkitError('runtime', 'vision-toolkit dependency probe returned invalid JSON', { cause: error })
  }
}

function parseLockedDependencies(requirements: Buffer): Record<string, string> {
  const dependencies: Record<string, string> = {}
  for (const line of requirements.toString('utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+)==([^\s]+)$/.exec(trimmed)
    if (match === null) {
      throw new VisionToolkitError('runtime', `runtime/requirements.lock contains an unsupported entry: ${trimmed}`)
    }
    dependencies[(match[1] ?? '').toLowerCase()] = match[2] ?? ''
  }
  if (Object.keys(dependencies).length === 0) {
    throw new VisionToolkitError('runtime', 'runtime/requirements.lock contains no dependencies')
  }
  return dependencies
}

function assertLockedDependencies(actual: Record<string, string>, expected: Record<string, string>): void {
  for (const [name, version] of Object.entries(expected)) {
    if (actual[name] !== version) {
      throw new VisionToolkitError(
        'runtime',
        `vision-toolkit Python dependency ${name} must be ${version}, received ${actual[name] ?? 'missing'}`,
      )
    }
  }
}

async function readRuntimeMarker(path: string): Promise<RuntimeMarker | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<RuntimeMarker>
    if (
      parsed.schemaVersion !== 1
      || parsed.upstreamCommit !== UPSTREAM_COMMIT
      || typeof parsed.upstreamContentSha256 !== 'string'
      || typeof parsed.requirementsSha256 !== 'string'
      || typeof parsed.pythonVersion !== 'string'
      || typeof parsed.dependencies !== 'object'
      || parsed.dependencies === null
      || (parsed.manager !== 'uv' && parsed.manager !== 'venv-pip')
    ) return undefined
    return parsed as RuntimeMarker
  } catch {
    return undefined
  }
}

async function waitForManagedRuntime(
  markerPath: string,
  lockPath: string,
  expected: Pick<RuntimeMarker, 'upstreamContentSha256' | 'requirementsSha256'>,
): Promise<RuntimeMarker | undefined> {
  const started = Date.now()
  while (Date.now() - started < PREPARE_TIMEOUT_MS) {
    const marker = await readRuntimeMarker(markerPath)
    if (
      marker?.upstreamContentSha256 === expected.upstreamContentSha256
      && marker.requirementsSha256 === expected.requirementsSha256
    ) return marker
    try {
      const info = await stat(lockPath)
      if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await withWindowsTransientRetry(() => rm(lockPath, { recursive: true, force: true }))
        return undefined
      }
    } catch {
      return undefined
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new VisionToolkitError('runtime', 'timed out waiting for another process to prepare the managed vision runtime')
}

async function releaseManagedLock(lockPath: string, owner: string): Promise<void> {
  try {
    if ((await readFile(join(lockPath, 'owner'), 'utf8')).trim() !== owner) return
  } catch {
    return
  }
  await withWindowsTransientRetry(() => rm(lockPath, { recursive: true, force: true }))
}

async function prepareManaged(
  ctx: Context,
  config: ResolvedVisionToolkitConfig,
  manifest: UpstreamManifest,
): Promise<PreparedUpstreamRuntime> {
  const stateRoot = visionToolkitStateRoot()
  await mkdir(stateRoot, { recursive: true })
  await garbageCollectRuntimeCache(ctx, stateRoot)
  const cleanHome = join(stateRoot, 'home')
  await mkdir(cleanHome, { recursive: true })
  const bootstrap = await resolveBootstrapPython(ctx, config.runtime.python, cleanHome)
  const requirements = await readFile(REQUIREMENTS_PATH)
  const requirementsSha256 = sha256(requirements)
  const expectedDependencies = parseLockedDependencies(requirements)
  const runtimeId = [
    manifest.contentSha256.slice(0, 16),
    requirementsSha256.slice(0, 16),
    `py${String(bootstrap.major)}${String(bootstrap.minor)}`,
    process.platform,
    process.arch,
  ].join('-')
  const finalRoot = join(stateRoot, 'python', runtimeId)
  const parent = dirname(finalRoot)
  await mkdir(parent, { recursive: true })
  const markerPath = join(finalRoot, 'runtime.json')
  const existing = await readRuntimeMarker(markerPath)
  const interpreter = venvPython(finalRoot)
  if (
    existing?.upstreamContentSha256 === manifest.contentSha256
    && existing.requirementsSha256 === requirementsSha256
  ) {
    const python: RuntimeCommand = { program: interpreter, prefix: [], display: interpreter }
    const metadata = await pythonMetadata(ctx, python, cleanHome)
    if (metadata !== undefined) {
      try {
        const dependencies = await dependencyVersions(ctx, python, cleanHome)
        assertLockedDependencies(dependencies, expectedDependencies)
        return { source: 'managed', root: BUNDLED_ROOT, python, cleanHome, pythonVersion: metadata.version, dependencies }
      } catch {
        // A stale/corrupt environment is rebuilt below without disturbing it until the replacement is ready.
      }
    }
  }

  const lockPath = `${finalRoot}.lock`
  const lockOwner = randomUUID()
  let lockAcquired = false
  try {
    await mkdir(lockPath, { recursive: false })
    lockAcquired = true
    await writeFile(join(lockPath, 'owner'), `${lockOwner}\n`, { flag: 'wx' })
  } catch (error) {
    if (lockAcquired) {
      await withWindowsTransientRetry(() => rm(lockPath, { recursive: true, force: true })).catch(() => {})
      throw error
    }
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const completed = await waitForManagedRuntime(markerPath, lockPath, {
      upstreamContentSha256: manifest.contentSha256,
      requirementsSha256,
    })
    if (completed !== undefined) {
      const python: RuntimeCommand = { program: interpreter, prefix: [], display: interpreter }
      const metadata = await pythonMetadata(ctx, python, cleanHome)
      if (metadata !== undefined) {
        try {
          const dependencies = await dependencyVersions(ctx, python, cleanHome)
          assertLockedDependencies(dependencies, expectedDependencies)
          return { source: 'managed', root: BUNDLED_ROOT, python, cleanHome, pythonVersion: metadata.version, dependencies }
        } catch {
          // The completed marker is unusable; reacquire the lock and rebuild it.
        }
      }
    }
    return prepareManaged(ctx, config, manifest)
  }

  const staging = await mkdtemp(join(parent, `.prepare-${runtimeGarbageLockToken(runtimeId)}-`))
  const installEnv: NodeJS.ProcessEnv = {
    ...isolatedPythonEnvironment(cleanHome),
    UV_CACHE_DIR: join(stateRoot, 'uv-cache'),
  }
  const heartbeat = setInterval(() => {
    const now = new Date()
    void utimes(lockPath, now, now).catch(() => {})
  }, LOCK_HEARTBEAT_MS)
  heartbeat.unref()
  try {
    let manager: RuntimeMarker['manager'] = 'venv-pip'
    let created = false
    if (bootstrap.command.prefix.length === 0) {
      try {
        const uv = await runCollected(ctx, ['uv', '--version'], stateRoot, { env: installEnv })
        if (uv.exitCode === 0 && !uv.timedOut) {
          const executableEnv = Object.fromEntries(
            Object.entries(installEnv).filter((entry): entry is [string, string] => entry[1] !== undefined),
          )
          const interpreter = await ctx.subprocess.resolveExecutable(bootstrap.command.program, executableEnv)
          const create = await runCollected(
            ctx,
            ['uv', 'venv', '--python', interpreter, staging],
            stateRoot,
            { timeoutMs: PREPARE_TIMEOUT_MS, env: installEnv },
          )
          if (create.exitCode !== 0 || create.timedOut) {
            throw new VisionToolkitError('runtime', `uv failed to create the managed runtime: ${create.stderr.trim()}`)
          }
          await installDependenciesWithFallback(
            ctx,
            ['uv', 'pip', 'install', '--python', venvPython(staging), '--requirement', REQUIREMENTS_PATH],
            stateRoot,
            installEnv,
            'uv',
          )
          manager = 'uv'
          created = true
        }
      } catch (error) {
        if (error instanceof VisionToolkitError) throw error
      }
    }
    if (!created) {
      const create = await runCollected(
        ctx,
        [bootstrap.command.program, ...bootstrap.command.prefix, '-m', 'venv', '--without-pip', staging],
        stateRoot,
        { timeoutMs: PREPARE_TIMEOUT_MS, env: installEnv },
      )
      if (create.exitCode !== 0 || create.timedOut) {
        throw new VisionToolkitError('runtime', `Python failed to create the managed runtime: ${create.stderr.trim()}`)
      }
      // `python -m venv` normally bootstraps pip internally; with the Microsoft
      // Store Python that step exits 101 (see rewriteStorePythonVenvHome), so pip
      // is installed explicitly after the venv configuration is repaired.
      await rewriteStorePythonVenvHome(ctx, bootstrap, staging, installEnv, stateRoot)
      const pipBootstrap = await runCollected(
        ctx,
        [venvPython(staging), '-m', 'ensurepip', '--upgrade', '--default-pip'],
        stateRoot,
        { timeoutMs: PREPARE_TIMEOUT_MS, env: installEnv },
      )
      if (pipBootstrap.exitCode !== 0 || pipBootstrap.timedOut) {
        throw new VisionToolkitError('runtime', `Python failed to bootstrap pip in the managed runtime: ${pipBootstrap.stderr.trim()}`)
      }
      await installDependenciesWithFallback(
        ctx,
        [venvPython(staging), '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', REQUIREMENTS_PATH],
        stateRoot,
        installEnv,
        'pip',
      )
    }
    const stagedPython: RuntimeCommand = { program: venvPython(staging), prefix: [], display: venvPython(staging) }
    const metadata = await pythonMetadata(ctx, stagedPython, cleanHome)
    if (metadata === undefined) throw new VisionToolkitError('runtime', 'managed Python runtime did not start after installation')
    const dependencies = await dependencyVersions(ctx, stagedPython, cleanHome)
    assertLockedDependencies(dependencies, expectedDependencies)
    const marker: RuntimeMarker = {
      schemaVersion: 1,
      upstreamCommit: UPSTREAM_COMMIT,
      upstreamContentSha256: manifest.contentSha256,
      requirementsSha256,
      pythonVersion: metadata.version,
      dependencies,
      manager,
    }
    await writeFile(join(staging, 'runtime.json'), `${JSON.stringify(marker, null, 2)}\n`)
    const quarantine = `${finalRoot}.replaced-${Date.now()}-${randomUUID()}`
    let quarantined = false
    try {
      await withWindowsTransientRetry(() => rename(finalRoot, quarantine))
      quarantined = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await withWindowsTransientRetry(() => rename(staging, finalRoot))
    } catch (error) {
      if (quarantined) {
        try {
          await withWindowsTransientRetry(() => rename(quarantine, finalRoot))
        } catch (restoreError) {
          throw new VisionToolkitError(
            'runtime',
            `managed runtime replacement failed and the prior runtime could not be restored; recovery copy: ${quarantine}`,
            { cause: new AggregateError([error, restoreError]) },
          )
        }
      }
      throw error
    }
    await ignoreCleanupFailure(ctx, 'managed runtime quarantine', quarantine)
    const python: RuntimeCommand = { program: interpreter, prefix: [], display: interpreter }
    return { source: 'managed', root: BUNDLED_ROOT, python, cleanHome, pythonVersion: metadata.version, dependencies }
  } finally {
    clearInterval(heartbeat)
    await ignoreCleanupFailure(ctx, 'managed runtime staging', staging)
    await releaseManagedLock(lockPath, lockOwner).catch(error => {
      ctx.logger.warn(
        'dsh-vision-toolkit: managed runtime lock cleanup failed: %s',
        error instanceof Error ? error.message : String(error),
      )
    })
  }
}

async function snapshotFiles(root: string): Promise<string[]> {
  const result: string[] = []
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) await visit(join(directory, entry.name), relativePath)
      else if (entry.isFile()) result.push(relativePath)
      else throw new VisionToolkitError('runtime', `external snapshot contains a non-regular entry: ${relativePath}`)
    }
  }
  await visit(root, '')
  return result.sort()
}

async function externalMatchesBundledSnapshot(root: string, expected: UpstreamManifest): Promise<boolean> {
  const path = join(root, 'UPSTREAM_MANIFEST.json')
  try {
    const manifest = await readManifest(path)
    if (
      manifest.contentSha256 !== expected.contentSha256
      || JSON.stringify(manifest.files) !== JSON.stringify(expected.files)
    ) return false
    const expectedFiles = [...expected.files.map(entry => entry.path), 'UPSTREAM_MANIFEST.json'].sort()
    if (JSON.stringify(await snapshotFiles(root)) !== JSON.stringify(expectedFiles)) return false
    for (const entry of expected.files) {
      const target = join(root, ...entry.path.split('/'))
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink()) return false
      const bytes = await readFile(target)
      if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) return false
    }
    return true
  } catch {
    return false
  }
}

async function verifyExternalCheckout(ctx: Context, root: string, expected: UpstreamManifest): Promise<void> {
  const exactSnapshot = await externalMatchesBundledSnapshot(root, expected)
  if (exactSnapshot) return
  let head: CommandResult
  try {
    head = await runCollected(ctx, ['git', '-C', root, 'rev-parse', 'HEAD'], root)
  } catch (error) {
    throw new VisionToolkitError(
      'runtime',
      `external agent-vision-toolkit must be the clean pinned commit ${UPSTREAM_COMMIT} or an exact exported snapshot`,
      { cause: error },
    )
  }
  if (head.exitCode !== 0 || head.stdout.trim() !== UPSTREAM_COMMIT) {
    throw new VisionToolkitError('runtime', `external agent-vision-toolkit must be pinned at commit ${UPSTREAM_COMMIT}`)
  }
  const topLevel = await runCollected(ctx, ['git', '-C', root, 'rev-parse', '--show-toplevel'], root)
  let resolvedTopLevel: string | undefined
  try {
    resolvedTopLevel = topLevel.exitCode === 0 ? await realpath(topLevel.stdout.trim()) : undefined
  } catch {
    resolvedTopLevel = undefined
  }
  if (resolvedTopLevel !== root) {
    throw new VisionToolkitError('runtime', 'external agent-vision-toolkit path must be the checkout root')
  }
  const statusResult = await runCollected(ctx, ['git', '-C', root, 'status', '--porcelain=v1', '--untracked-files=all'], root)
  if (statusResult.exitCode !== 0 || statusResult.stdout.trim().length > 0) {
    throw new VisionToolkitError('runtime', 'external agent-vision-toolkit checkout has modified tracked files; use managed mode or a clean pinned checkout')
  }
}

async function prepareExternal(
  ctx: Context,
  config: ResolvedVisionToolkitConfig,
  manifest: UpstreamManifest,
): Promise<PreparedUpstreamRuntime> {
  const configured = config.runtime.agentVisionToolkitPath
  if (configured === undefined) {
    throw new VisionToolkitError('config', 'runtime.agentVisionToolkitPath is required when runtime.mode is external')
  }
  let root: string
  try {
    root = await realpath(expandHome(configured))
  } catch (error) {
    throw new VisionToolkitError('runtime', `external agent-vision-toolkit checkout is not accessible: ${configured}`, { cause: error })
  }
  await verifyExternalCheckout(ctx, root, manifest)
  const stateRoot = visionToolkitStateRoot()
  await mkdir(stateRoot, { recursive: true })
  const cleanHome = join(stateRoot, 'home')
  await mkdir(cleanHome, { recursive: true })
  const bootstrap = await resolveBootstrapPython(ctx, config.runtime.python, cleanHome)
  const dependencies = await dependencyVersions(ctx, bootstrap.command, cleanHome)
  assertLockedDependencies(dependencies, parseLockedDependencies(await readFile(REQUIREMENTS_PATH)))
  return {
    source: 'external',
    root,
    python: bootstrap.command,
    cleanHome,
    pythonVersion: bootstrap.version,
    dependencies,
  }
}

/** Prepare the configured pinned runtime without making any vision API call. */
export async function prepareUpstreamRuntime(
  ctx: Context,
  config: ResolvedVisionToolkitConfig,
): Promise<PreparedUpstreamRuntime> {
  const manifest = await verifyBundledUpstream()
  return config.runtime.mode === 'managed'
    ? prepareManaged(ctx, config, manifest)
    : prepareExternal(ctx, config, manifest)
}
