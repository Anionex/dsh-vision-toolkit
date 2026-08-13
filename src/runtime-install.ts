/**
 * Reproducible upstream runtime preparation. Managed mode uses the packaged,
 * hash-verified agent-vision-toolkit snapshot plus an atomic isolated Python
 * environment; external mode accepts only the pinned clean Git commit or an
 * exact exported copy of the packaged snapshot.
 * @module dsh-vision-toolkit/runtime-install
 */

import { createHash, randomUUID } from 'node:crypto'
import {
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
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'
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
const PROBE_TIMEOUT_MS = 30_000
const LOCK_STALE_MS = 15 * 60 * 1000
const LOCK_HEARTBEAT_MS = 5_000

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

function isolatedPythonEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: home,
    PYTHONHOME: undefined,
    PYTHONPATH: undefined,
    VIRTUAL_ENV: undefined,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
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
      env: isolatedPythonEnv(cwd),
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

async function resolveBootstrapPython(
  ctx: Context,
  configured: string | undefined,
  cwd: string,
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
  throw new VisionToolkitError(
    'runtime',
    configured === undefined
      ? 'vision-toolkit requires Python 3.11 or newer; tried python3, python, and the Windows py launcher'
      : `vision-toolkit requires Python 3.11 or newer: ${configured}`,
  )
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
      env: isolatedPythonEnv(cwd),
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
        await rm(lockPath, { recursive: true, force: true })
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
  await rm(lockPath, { recursive: true, force: true })
}

async function prepareManaged(
  ctx: Context,
  config: ResolvedVisionToolkitConfig,
  manifest: UpstreamManifest,
): Promise<PreparedUpstreamRuntime> {
  const stateRoot = visionToolkitStateRoot()
  await mkdir(stateRoot, { recursive: true })
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
      await rm(lockPath, { recursive: true, force: true })
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

  const staging = await mkdtemp(join(parent, '.prepare-'))
  const installEnv: NodeJS.ProcessEnv = {
    ...isolatedPythonEnv(cleanHome),
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
          const interpreter = await ctx.subprocess.resolveExecutable(bootstrap.command.program, installEnv)
          const create = await runCollected(
            ctx,
            ['uv', 'venv', '--python', interpreter, staging],
            stateRoot,
            { timeoutMs: PREPARE_TIMEOUT_MS, env: installEnv },
          )
          if (create.exitCode !== 0 || create.timedOut) {
            throw new VisionToolkitError('runtime', `uv failed to create the managed runtime: ${create.stderr.trim()}`)
          }
          const install = await runCollected(
            ctx,
            ['uv', 'pip', 'install', '--python', venvPython(staging), '--requirement', REQUIREMENTS_PATH],
            stateRoot,
            { timeoutMs: PREPARE_TIMEOUT_MS, env: installEnv },
          )
          if (install.exitCode !== 0 || install.timedOut) {
            throw new VisionToolkitError('runtime', `uv failed to install managed runtime dependencies: ${install.stderr.trim()}`)
          }
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
        [bootstrap.command.program, ...bootstrap.command.prefix, '-m', 'venv', staging],
        stateRoot,
        { timeoutMs: PREPARE_TIMEOUT_MS, env: installEnv },
      )
      if (create.exitCode !== 0 || create.timedOut) {
        throw new VisionToolkitError('runtime', `Python failed to create the managed runtime: ${create.stderr.trim()}`)
      }
      const install = await runCollected(
        ctx,
        [venvPython(staging), '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', REQUIREMENTS_PATH],
        stateRoot,
        { timeoutMs: PREPARE_TIMEOUT_MS, env: installEnv },
      )
      if (install.exitCode !== 0 || install.timedOut) {
        throw new VisionToolkitError('runtime', `pip failed to install managed runtime dependencies: ${install.stderr.trim()}`)
      }
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
    const quarantine = `${finalRoot}.replaced-${randomUUID()}`
    let quarantined = false
    try {
      await rename(finalRoot, quarantine)
      quarantined = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await rename(staging, finalRoot)
    } catch (error) {
      if (quarantined) {
        try {
          await rename(quarantine, finalRoot)
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
    await rm(quarantine, { recursive: true, force: true })
    const python: RuntimeCommand = { program: interpreter, prefix: [], display: interpreter }
    return { source: 'managed', root: BUNDLED_ROOT, python, cleanHome, pythonVersion: metadata.version, dependencies }
  } finally {
    clearInterval(heartbeat)
    await rm(staging, { recursive: true, force: true })
    await releaseManagedLock(lockPath, lockOwner)
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
