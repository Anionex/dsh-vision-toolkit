import { statSync } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { c as createTar } from 'tar'
import { resolveConfig } from '../src/config.ts'
import { UPSTREAM_COMMIT } from '../src/version.ts'
import {
  acquireBundledPython,
  bundledUpstreamRoot,
  garbageCollectRuntimeCache,
  ignoreCleanupFailure,
  prepareUpstreamRuntime,
  pythonBootstrapTarget,
  resolveBootstrapPython,
  rewriteVenvConfig,
  storePythonProbeEnvironment,
  visionToolkitStateRoot,
} from '../src/runtime-install.ts'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: vi.fn((path: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => actual.rm(path, options)),
  }
})

const rmMock = vi.mocked(rm)
let realRm: typeof rm

beforeAll(async () => {
  realRm = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rm
})

class ProbeSubprocessService extends SubprocessRuntime {
  readonly spawns: SubprocessSpawnSpec[] = []

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const command = spec.argv.join('\n')
    const isMetadata = command.includes('sys.version_info')
    const isDependencies = command.includes('import PIL')
    const stdout = isMetadata
      ? '{"version":"3.12.0","major":3,"minor":12}\n'
      : isDependencies
        ? '{"pillow":"12.3.0","numpy":"2.4.6","vtracer":"0.6.15"}\n'
        : ''
    const exitCode = isMetadata || isDependencies ? 0 : 1
    const stderr = exitCode === 0 ? '' : 'not a git checkout\n'
    const read = (text: string): SubprocessOutputRead => ({ text, nextOffset: Buffer.byteLength(text), lossy: false })
    return {
      pid: this.spawns.length,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: { readFrom: () => read(stdout) },
        stderr: { readFrom: () => read(stderr) },
      },
      done: Promise.resolve({ exitCode, signal: null }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }
}

const roots: string[] = []
const contexts: Context[] = []
let originalDshHome: string | undefined

beforeEach(async () => {
  rmMock.mockImplementation((path, options) => realRm(path, options))
  originalDshHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-vt-runtime-home-'))
  roots.push(home)
  process.env.DSH_HOME = home
})

afterEach(async () => {
  rmMock.mockImplementation((path, options) => realRm(path, options))
  vi.unstubAllGlobals()
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function copiedSnapshot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-vt-upstream-copy-'))
  roots.push(root)
  const copy = join(root, 'agent-vision-toolkit')
  await cp(bundledUpstreamRoot(), copy, { recursive: true })
  return copy
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function runtimeGcToken(lockBase: string): string {
  return createHash('sha256').update(lockBase).digest('hex').slice(0, 12)
}

async function setup(path: string) {
  const ctx = new Context()
  contexts.push(ctx)
  const fiber = await ctx.plugin(ProbeSubprocessService)
  const config = resolveConfig({
    runtime: { mode: 'external', agentVisionToolkitPath: path, python: 'python3' },
  })
  return { ctx, service: fiber.ctx.subprocess as ProbeSubprocessService, config }
}

describe('external pinned runtime preparation', () => {
  it('accepts an exact exported snapshot and scrubs ambient Python overrides', async () => {
    const snapshot = await copiedSnapshot()
    const { ctx, service, config } = await setup(snapshot)
    const prepared = await prepareUpstreamRuntime(ctx, config)
    expect(prepared).toMatchObject({
      source: 'external',
      pythonVersion: '3.12.0',
      dependencies: { pillow: '12.3.0', numpy: '2.4.6', vtracer: '0.6.15' },
    })
    expect(prepared.root).toBe(await realpath(snapshot))
    expect(service.spawns).toHaveLength(2)
    for (const spawn of service.spawns) {
      expect(spawn.env).toMatchObject({
        HOME: prepared.cleanHome,
        USERPROFILE: prepared.cleanHome,
        PYTHONHOME: undefined,
        PYTHONPATH: undefined,
        VIRTUAL_ENV: undefined,
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONNOUSERSITE: '1',
        PYTHONUTF8: '1',
      })
    }
  })

  it('rejects a modified export instead of trusting its manifest declaration', async () => {
    const snapshot = await copiedSnapshot()
    await writeFile(join(snapshot, 'vision_client.py'), '# modified\n')
    const { ctx, config } = await setup(snapshot)
    await expect(prepareUpstreamRuntime(ctx, config)).rejects.toMatchObject({ code: 'runtime' })
  })

  it('rejects unmanifested files that could shadow pinned Python imports', async () => {
    const snapshot = await copiedSnapshot()
    await writeFile(join(snapshot, 'PIL.py'), 'raise RuntimeError("shadowed")\n')
    const { ctx, config } = await setup(snapshot)
    await expect(prepareUpstreamRuntime(ctx, config)).rejects.toMatchObject({ code: 'runtime' })
  })
})

describe('rewriteVenvConfig (Microsoft Store Python workaround)', () => {
  it('preserves Python environment tombstones while restoring host user directories', () => {
    const out = storePythonProbeEnvironment({
      HOME: '/isolated',
      USERPROFILE: '/isolated',
      LOCALAPPDATA: '/isolated',
      PYTHONHOME: undefined,
      PYTHONPATH: undefined,
      VIRTUAL_ENV: undefined,
      PYTHONNOUSERSITE: '1',
    })
    expect(out).not.toHaveProperty('HOME')
    expect(out).not.toHaveProperty('USERPROFILE')
    expect(out).not.toHaveProperty('LOCALAPPDATA')
    expect(out).toHaveProperty('PYTHONHOME', undefined)
    expect(out).toHaveProperty('PYTHONPATH', undefined)
    expect(out).toHaveProperty('VIRTUAL_ENV', undefined)
    expect(out).toHaveProperty('PYTHONNOUSERSITE', '1')
  })

  it('repairs a Program Files\\WindowsApps home to the app execution alias directory', () => {
    const cfg = [
      'home = C:\\Program Files\\WindowsApps\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0',
      'include-system-site-packages = false',
      'version = 3.13.14',
      'executable = C:\\Program Files\\WindowsApps\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\\python3.13.exe',
    ].join('\n')
    const aliasDir = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0'
    const out = rewriteVenvConfig(cfg, aliasDir)
    expect(out).toContain(`home = ${aliasDir}`)
    expect(out).toContain(`executable = ${aliasDir}\\python.exe`)
    expect(out).toContain('version = 3.13.14')
    expect(out).toContain('include-system-site-packages = false')
  })

  it('leaves a non-Store Python configuration untouched', () => {
    const cfg = [
      'home = C:\\Python313',
      'include-system-site-packages = false',
      'version = 3.13.14',
      'executable = C:\\Python313\\python.exe',
    ].join('\n')
    const out = rewriteVenvConfig(cfg, 'C:\\Python313')
    expect(out).toBe(cfg)
  })
})

class BundledPythonSubprocessService extends SubprocessRuntime {
  readonly spawns: SubprocessSpawnSpec[] = []

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const command = spec.argv.join(' ')
    const interpreter = spec.argv[0] ?? ''
    const isMetadata = command.includes('sys.version_info')
    let exitCode = 1
    let stdout = ''
    let stderr = 'python: not found\n'
    if (isMetadata) {
      if (interpreter.includes('python-bootstrap')) {
        try {
          if (statSync(interpreter).isFile()) {
            exitCode = 0
            stdout = '{"version":"3.13.15","major":3,"minor":13}\n'
            stderr = ''
          }
        } catch {
          // The bundled interpreter has not been extracted yet.
        }
      } else if (interpreter !== 'python3' && interpreter !== 'python' && interpreter !== 'py') {
        exitCode = 0
        stdout = '{"version":"3.13.15","major":3,"minor":13}\n'
        stderr = ''
      }
    }
    const read = (text: string): SubprocessOutputRead => ({ text, nextOffset: Buffer.byteLength(text), lossy: false })
    return {
      pid: this.spawns.length,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: { readFrom: () => read(stdout) },
        stderr: { readFrom: () => read(stderr) },
      },
      done: Promise.resolve({ exitCode, signal: null }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }
}

async function bundledPythonFixtureArchive(): Promise<Buffer> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-vt-python-fixture-'))
  roots.push(root)
  try {
    const interpreterDir = process.platform === 'win32'
      ? join(root, 'python')
      : join(root, 'python', 'bin')
    await mkdir(interpreterDir, { recursive: true })
    const interpreter = process.platform === 'win32'
      ? join(interpreterDir, 'python.exe')
      : join(interpreterDir, 'python3')
    await writeFile(interpreter, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    await mkdir(join(root, 'python', 'lib'), { recursive: true })
    await writeFile(join(root, 'python', 'lib', 'marker.txt'), 'fixture\n')
    const archive = join(root, 'python.tar.gz')
    await createTar({ gzip: true, cwd: root, file: archive, portable: true }, ['python'])
    return await readFile(archive)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function stubBundledPythonDownload(payload: Buffer): ReturnType<typeof vi.fn> {
  const requestMock = vi.fn(async (_url: string, _signal: AbortSignal) => {
    return {
      statusCode: 200,
      headers: {},
      body: Readable.from([payload]),
      close: async () => {},
    }
  })
  return requestMock
}

async function bundledPythonFixtureManifest(): Promise<{
  archive: Buffer
  manifest: Parameters<typeof acquireBundledPython>[3]
}> {
  const archive = await bundledPythonFixtureArchive()
  const target = pythonBootstrapTarget(process.platform, process.arch, false)
  return {
    archive,
    manifest: {
      schemaVersion: 1,
      pythonVersion: '3.13.15',
      buildTag: '20260814',
      mirrorBaseUrl: 'https://dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com',
      artifacts: {
        [target]: {
          url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260814/fixture.tar.gz',
          sha256: createHash('sha256').update(archive).digest('hex'),
          size: archive.length,
        },
      },
    },
  }
}

describe('bundled Python bootstrap', () => {
  it('maps Node platforms to pinned python-build-standalone targets', () => {
    expect(pythonBootstrapTarget('darwin', 'arm64', false)).toBe('darwin-arm64')
    expect(pythonBootstrapTarget('darwin', 'x64', false)).toBe('darwin-x64')
    expect(pythonBootstrapTarget('win32', 'x64', false)).toBe('win32-x64')
    expect(pythonBootstrapTarget('win32', 'arm64', false)).toBe('win32-arm64')
    expect(pythonBootstrapTarget('linux', 'x64', false)).toBe('linux-x64')
    expect(pythonBootstrapTarget('linux', 'arm64', false)).toBe('linux-arm64')
    expect(pythonBootstrapTarget('linux', 'x64', true)).toBe('linux-x64-musl')
    expect(pythonBootstrapTarget('linux', 'arm64', true)).toBe('linux-arm64-musl')
  })

  it('downloads, verifies, extracts, and reuses the cached interpreter', async () => {
    const { archive, manifest } = await bundledPythonFixtureManifest()
    const requestMock = stubBundledPythonDownload(archive)
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = await ctx.plugin(BundledPythonSubprocessService)
    const stateRoot = visionToolkitStateRoot()
    await mkdir(join(stateRoot, 'home'), { recursive: true })
    const first = await acquireBundledPython(ctx, stateRoot, join(stateRoot, 'home'), manifest, requestMock)
    const target = pythonBootstrapTarget(process.platform, process.arch, false)
    expect(first.version).toBe('3.13.15')
    expect(first.command.program).toContain(join('python-bootstrap', `3.13.15-${target}`))
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith(
      expect.stringContaining('dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com/20260814/fixture.tar.gz'),
      expect.any(AbortSignal),
    )
    const second = await acquireBundledPython(ctx, stateRoot, join(stateRoot, 'home'), manifest)
    expect(second.command.program).toBe(first.command.program)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a downloaded archive whose digest does not match the manifest', async () => {
    const { manifest } = await bundledPythonFixtureManifest()
    const requestMock = stubBundledPythonDownload(Buffer.from('not the pinned python archive'))
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = await ctx.plugin(BundledPythonSubprocessService)
    const stateRoot = visionToolkitStateRoot()
    await mkdir(join(stateRoot, 'home'), { recursive: true })
    await expect(acquireBundledPython(ctx, stateRoot, join(stateRoot, 'home'), manifest, requestMock)).rejects.toMatchObject({
      code: 'runtime',
      message: expect.stringContaining('could not be downloaded'),
    })
  })

  it('falls back to the bundled Python only when no system Python is found', async () => {
    const { archive, manifest } = await bundledPythonFixtureManifest()
    const requestMock = stubBundledPythonDownload(archive)
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = await ctx.plugin(BundledPythonSubprocessService)
    const stateRoot = visionToolkitStateRoot()
    await mkdir(join(stateRoot, 'home'), { recursive: true })
    const resolved = await resolveBootstrapPython(ctx, undefined, join(stateRoot, 'home'), manifest, requestMock)
    expect(resolved.version).toBe('3.13.15')
    expect(resolved.command.program).toContain(join('python-bootstrap', '3.13.15-'))
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('does not auto-download when the user configured an interpreter', async () => {
    const requestMock = stubBundledPythonDownload(Buffer.alloc(0))
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = await ctx.plugin(BundledPythonSubprocessService)
    const stateRoot = visionToolkitStateRoot()
    await mkdir(join(stateRoot, 'home'), { recursive: true })
    await expect(resolveBootstrapPython(ctx, 'python3', join(stateRoot, 'home'))).rejects.toMatchObject({
      code: 'runtime',
      message: expect.stringContaining('Python 3.11 or newer: python3'),
    })
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('falls back to the GitHub release when the domestic mirror is unreachable', async () => {
    const { archive, manifest } = await bundledPythonFixtureManifest()
    const requestMock = vi.fn()
      .mockRejectedValueOnce(new Error('connect timeout'))
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: Readable.from([archive]),
        close: async () => {},
      })
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = await ctx.plugin(BundledPythonSubprocessService)
    const stateRoot = visionToolkitStateRoot()
    await mkdir(join(stateRoot, 'home'), { recursive: true })
    const acquired = await acquireBundledPython(ctx, stateRoot, join(stateRoot, 'home'), manifest, requestMock)
    expect(acquired.version).toBe('3.13.15')
    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com/'),
      expect.any(AbortSignal),
    )
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('python-build-standalone/releases/download/'),
      expect.any(AbortSignal),
    )
  })

  it('keeps the primary download error when staging cleanup also fails', async () => {
    const { manifest } = await bundledPythonFixtureManifest()
    const requestMock = vi.fn().mockRejectedValue(new Error('download boom'))
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = await ctx.plugin(BundledPythonSubprocessService)
    const stateRoot = visionToolkitStateRoot()
    await mkdir(join(stateRoot, 'home'), { recursive: true })
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    rmMock.mockImplementation(async (path, options) => {
      if (String(path).includes('.python-bootstrap-')) throw busy
      return realRm(path, options)
    })
    const warn = vi.spyOn(ctx.logger, 'warn')
    await expect(acquireBundledPython(ctx, stateRoot, join(stateRoot, 'home'), manifest, requestMock)).rejects.toMatchObject({
      code: 'runtime',
      message: expect.stringContaining('could not be downloaded'),
    })
    expect(warn).toHaveBeenCalledWith(
      'dsh-vision-toolkit: %s cleanup failed: %s',
      'bundled Python staging',
      'busy',
    )
  })
})

describe('cleanup failure isolation', () => {
  it('turns successful-path cleanup failures into warnings only', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(BundledPythonSubprocessService)
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    rmMock.mockImplementation(async () => {
      throw busy
    })
    const warn = vi.spyOn(ctx.logger, 'warn')
    await expect(ignoreCleanupFailure(ctx, 'managed runtime quarantine', join(tmpdir(), 'quarantine'))).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      'dsh-vision-toolkit: %s cleanup failed: %s',
      'managed runtime quarantine',
      'busy',
    )
  })
})

describe('runtime cache garbage collection', () => {
  it('removes orphaned current-format trees while preserving active and recent legacy work', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(BundledPythonSubprocessService)
    const stateRoot = visionToolkitStateRoot()
    const pythonRoot = join(stateRoot, 'python')
    const bootstrapRoot = join(stateRoot, 'python-bootstrap')
    await mkdir(pythonRoot, { recursive: true })
    await mkdir(bootstrapRoot, { recursive: true })

    const orphaned = [
      join(pythonRoot, `.prepare-${runtimeGcToken('runtime-a')}-ABC123`),
      join(bootstrapRoot, `.python-bootstrap-${runtimeGcToken('3.13.15-test-x64')}-ABC123`),
    ]
    const now = Date.now()
    const staleMs = now - 25 * 60 * 60 * 1000
    const recentQuarantine = join(pythonRoot, `runtime-a.replaced-${now}-recovery`)
    const staleQuarantine = join(pythonRoot, `runtime-c.replaced-${staleMs}-stale`)
    const activeQuarantine = join(pythonRoot, `runtime-b.replaced-${staleMs}-active`)
    const activePrepare = join(pythonRoot, `.prepare-${runtimeGcToken('runtime-b')}-ABC123`)
    const activeBootstrap = join(bootstrapRoot, `.python-bootstrap-${runtimeGcToken('3.14.0-test-x64')}-ABC123`)
    const active = [activeQuarantine, activePrepare, activeBootstrap]
    const recentLegacy = join(pythonRoot, '.prepare-ABC123')
    const staleLegacy = [
      join(pythonRoot, '.prepare-OLD123'),
      join(bootstrapRoot, '.python-bootstrap-OLD123'),
    ]
    for (const path of [...orphaned, recentQuarantine, staleQuarantine, ...active, recentLegacy, ...staleLegacy]) {
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'payload'), 'fixture')
    }
    await mkdir(join(pythonRoot, 'runtime-b.lock'), { recursive: true })
    await mkdir(join(bootstrapRoot, '3.14.0-test-x64.lock'), { recursive: true })
    const stale = new Date(now - 25 * 60 * 60 * 1000)
    for (const path of staleLegacy) await utimes(path, stale, stale)

    await garbageCollectRuntimeCache(ctx, stateRoot, now)

    for (const path of [...orphaned, staleQuarantine]) expect(await pathExists(path)).toBe(false)
    for (const path of [recentQuarantine, ...active, recentLegacy, ...staleLegacy]) {
      expect(await pathExists(path)).toBe(true)
    }

    await rm(join(pythonRoot, 'runtime-b.lock'), { recursive: true, force: true })
    await rm(join(bootstrapRoot, '3.14.0-test-x64.lock'), { recursive: true, force: true })
    await garbageCollectRuntimeCache(ctx, stateRoot, now)

    for (const path of [activePrepare, activeBootstrap, ...staleLegacy]) expect(await pathExists(path)).toBe(false)
    expect(await pathExists(activeQuarantine)).toBe(false)
    expect(await pathExists(recentQuarantine)).toBe(true)
    expect(await pathExists(recentLegacy)).toBe(true)

    await garbageCollectRuntimeCache(ctx, stateRoot, now + 25 * 60 * 60 * 1000)
    expect(await pathExists(recentQuarantine)).toBe(false)
  })

  it('runs before a cached managed runtime is reused', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = await ctx.plugin(ProbeSubprocessService)
    const stateRoot = visionToolkitStateRoot()
    const manifest = JSON.parse(
      await readFile(join(bundledUpstreamRoot(), 'UPSTREAM_MANIFEST.json'), 'utf8'),
    ) as { contentSha256: string }
    const requirements = await readFile(join(process.cwd(), 'runtime', 'requirements.lock'))
    const requirementsSha256 = createHash('sha256').update(requirements).digest('hex')
    const runtimeId = [
      manifest.contentSha256.slice(0, 16),
      requirementsSha256.slice(0, 16),
      'py312',
      process.platform,
      process.arch,
    ].join('-')
    const finalRoot = join(stateRoot, 'python', runtimeId)
    const now = Date.now()
    const quarantine = `${finalRoot}.replaced-${now - 25 * 60 * 60 * 1000}-stale`
    const recovery = `${finalRoot}.replaced-${now}-recovery`
    await mkdir(finalRoot, { recursive: true })
    await mkdir(quarantine, { recursive: true })
    await mkdir(recovery, { recursive: true })
    await writeFile(join(finalRoot, 'runtime.json'), `${JSON.stringify({
      schemaVersion: 1,
      upstreamCommit: UPSTREAM_COMMIT,
      upstreamContentSha256: manifest.contentSha256,
      requirementsSha256,
      pythonVersion: '3.12.0',
      dependencies: { pillow: '12.3.0', numpy: '2.4.6', vtracer: '0.6.15' },
      manager: 'uv',
    })}\n`)
    const config = resolveConfig({
      runtime: { mode: 'managed', python: '/fixture/python' },
    })

    const prepared = await prepareUpstreamRuntime(ctx, config)

    expect(prepared.pythonVersion).toBe('3.12.0')
    expect((fiber.ctx.subprocess as ProbeSubprocessService).spawns.length).toBeGreaterThan(0)
    expect(await pathExists(finalRoot)).toBe(true)
    expect(await pathExists(quarantine)).toBe(false)
    expect(await pathExists(recovery)).toBe(true)
  })
})
