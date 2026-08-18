import { statSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { c as createTar } from 'tar'
import { resolveConfig } from '../src/config.ts'
import {
  acquireBundledPython,
  bundledUpstreamRoot,
  prepareUpstreamRuntime,
  pythonBootstrapTarget,
  resolveBootstrapPython,
  rewriteVenvConfig,
  storePythonProbeEnvironment,
  visionToolkitStateRoot,
} from '../src/runtime-install.ts'

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
  originalDshHome = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-vt-runtime-home-'))
  roots.push(home)
  process.env.DSH_HOME = home
})

afterEach(async () => {
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
      expect.stringContaining('python-build-standalone/releases/download/'),
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
})
