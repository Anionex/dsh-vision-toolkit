import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compareVersions,
  PLUGIN_RESTART_HELPER_SOURCE,
  VisionToolkitPluginUpdateService,
  VISION_TOOLKIT_PACKAGE,
} from '../src/plugin-update.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function output(text: string): SubprocessOutputRead {
  return { text, nextOffset: Buffer.byteLength(text), lossy: false }
}

class FakeSubprocess {
  readonly spawns: SubprocessSpawnSpec[] = []
  readonly resolveExecutable = vi.fn(async () => '/usr/local/bin/pnpm')

  constructor(
    private readonly run: (spec: SubprocessSpawnSpec) => Promise<{ stdout?: string; stderr?: string; exitCode?: number }>,
  ) {}

  spawn = (spec: SubprocessSpawnSpec): SubprocessHandle => {
    this.spawns.push(spec)
    const result = this.run(spec)
    const collected = {
      stdout: { readFrom: () => output('') },
      stderr: { readFrom: () => output('') },
    }
    const handle: SubprocessHandle = {
      pid: this.spawns.length,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected,
      done: result.then((value) => {
        const stdout = value.stdout ?? ''
        const stderr = value.stderr ?? ''
        Object.assign(collected, {
          stdout: { readFrom: () => output(stdout) },
          stderr: { readFrom: () => output(stderr) },
        })
        return { exitCode: value.exitCode ?? 0, signal: null }
      }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
    return handle
  }
}

async function profileFixture(spec = '0.1.0') {
  const root = await mkdtemp(join(tmpdir(), 'dvt-plugin-update-'))
  roots.push(root)
  const profileDir = join(root, 'profiles', 'web')
  const installedDir = join(profileDir, 'node_modules', '@anionex', 'dsh-vision-toolkit')
  await mkdir(installedDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: { [VISION_TOOLKIT_PACKAGE]: spec },
  }))
  await writeFile(join(installedDir, 'package.json'), JSON.stringify({
    name: VISION_TOOLKIT_PACKAGE,
    version: '0.1.0',
  }))
  return { profileDir, installedDir }
}

function host(subprocess: FakeSubprocess): Pick<Context, 'subprocess'> {
  return { subprocess: subprocess as unknown as Context['subprocess'] }
}

describe('plugin update version ordering', () => {
  it('orders stable and prerelease SemVer versions correctly', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })
})

describe('VisionToolkitPluginUpdateService', () => {
  it('does not overwrite a local link installation', async () => {
    const fixture = await profileFixture('link:/workspace/dsh-vision-toolkit')
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    await expect(service.capability()).resolves.toEqual({
      supported: false,
      checkSupported: true,
      profile: 'web',
      dependencySpec: 'link:/workspace/dsh-vision-toolkit',
      reason: 'unsupported-install-source',
    })
    expect(subprocess.resolveExecutable).toHaveBeenCalledWith('pnpm')
  })

  it('requires an explicit opt-in for detached restart ownership', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
    })

    await expect(service.capability()).resolves.toMatchObject({
      supported: false,
      profile: 'web',
      reason: 'restart-unmanaged',
    })
    expect(subprocess.resolveExecutable).toHaveBeenCalledWith('pnpm')
  })

  it('disables automatic restart when DSH Web uses a dynamically allocated port', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web', '--port', '0'],
      allowDetachedRestart: true,
    })

    await expect(service.capability()).resolves.toMatchObject({
      supported: false,
      checkSupported: true,
      reason: 'restart-address-unavailable',
    })
  })

  it('fails closed when the active WebServer port was not supplied explicitly', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    service.configureWebServer('0.0.0.0', 8080)
    await expect(service.capability()).resolves.toMatchObject({
      supported: false,
      reason: 'restart-address-unavailable',
    })
  })

  it('uses the active WebServer address when it matches an explicit fixed port', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web', '--host', '0.0.0.0', '--port', '8080'],
      allowDetachedRestart: true,
    })

    service.configureWebServer('0.0.0.0', 8080)
    await expect(service.capability()).resolves.toMatchObject({ supported: true })
  })

  it('does not advertise the POSIX restart handoff on Windows', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      platform: 'win32',
    })

    await expect(service.capability()).resolves.toMatchObject({
      supported: false,
      profile: 'web',
      reason: 'unsupported-platform',
    })
  })

  it('checks the configured registry through pnpm without mutating the profile', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      now: () => new Date('2026-08-16T12:00:00.000Z'),
    })

    await expect(service.check()).resolves.toMatchObject({
      supported: true,
      profile: 'web',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      checkedAt: '2026-08-16T12:00:00.000Z',
    })
    expect(subprocess.spawns[0]?.argv).toEqual([
      '/usr/local/bin/pnpm', 'view', VISION_TOOLKIT_PACKAGE, 'version', '--json',
    ])
  })

  it('updates only this package, verifies the installed version, and schedules a restart', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.2.0',
      }))
      return { stdout: 'updated\n' }
    })
    const prepareRestart = vi.fn()
    const terminateCurrent = vi.fn()
    const schedule = vi.fn((callback: () => void) => { callback() })
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      prepareRestart,
      terminateCurrent,
      schedule,
    })

    await expect(service.installAndRestart('0.2.0')).resolves.toMatchObject({
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      profile: 'web',
      restarting: true,
    })
    expect(subprocess.spawns[1]?.argv).toEqual([
      '/usr/local/bin/pnpm',
      'add',
      `${VISION_TOOLKIT_PACKAGE}@0.2.0`,
      '--save-exact',
      '--yes',
      '--reporter=append-only',
    ])
    expect(prepareRestart).toHaveBeenCalledTimes(1)
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(terminateCurrent).toHaveBeenCalledTimes(1)
    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-in-progress' })
    expect(subprocess.spawns).toHaveLength(2)
  })

  it('rejects a stale confirmation instead of installing an unexpected release', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.1"\n' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-stale' })
    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-stale' })
    expect(subprocess.spawns).toHaveLength(2)
  })

  it('rechecks the profile source instead of overwriting a link introduced after an earlier check', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    await expect(service.check()).resolves.toMatchObject({ supported: true, latestVersion: '0.2.0' })
    await writeFile(join(fixture.profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { [VISION_TOOLKIT_PACKAGE]: 'link:/workspace/dsh-vision-toolkit' },
    }))

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-unavailable' })
    expect(subprocess.spawns).toHaveLength(1)
  })

  it('uses a profile lock to reject a concurrent updater in another service instance', async () => {
    const fixture = await profileFixture()
    let releaseView!: () => void
    const viewGate = new Promise<void>((resolve) => { releaseView = resolve })
    const firstSubprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) {
        await viewGate
        return { stdout: '"0.2.0"\n' }
      }
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.2.0',
      }))
      return { stdout: 'updated\n' }
    })
    const first = new VisionToolkitPluginUpdateService(host(firstSubprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      prepareRestart: vi.fn(),
      terminateCurrent: vi.fn(),
      schedule: vi.fn(),
    })
    const running = first.installAndRestart('0.2.0')
    await vi.waitFor(() => { expect(firstSubprocess.spawns).toHaveLength(1) })

    const secondSubprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const second = new VisionToolkitPluginUpdateService(host(secondSubprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })
    await expect(second.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-in-progress' })
    expect(secondSubprocess.spawns).toHaveLength(0)

    releaseView()
    await expect(running).resolves.toMatchObject({ toVersion: '0.2.0' })
  })

  it('redacts registry credentials from command failures returned to Settings', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({
      exitCode: 1,
      stderr: 'GET https://alice:secret@registry.example/?token=query-secret failed '
        + 'https://single-secret@registry.example/ npm_supersecret _authToken=token-value _auth=base64-secret',
    }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
    })

    const failure = await service.check().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).not.toContain('alice')
    expect(message).not.toContain('secret')
    expect(message).not.toContain('supersecret')
    expect(message).not.toContain('token-value')
    expect(message).not.toContain('query-secret')
    expect(message).not.toContain('single-secret')
    expect(message).not.toContain('base64-secret')
    expect(message).toContain('***')
  })

  it('restores the original manifest and lockfile after pnpm partially changes the profile then fails', async () => {
    const fixture = await profileFixture('^0.1.0')
    const manifestPath = join(fixture.profileDir, 'package.json')
    const lockfilePath = join(fixture.profileDir, 'pnpm-lock.yaml')
    const originalManifest = await readFile(manifestPath)
    const originalLockfile = Buffer.from('lockfileVersion: 9\noriginal: true\n')
    await writeFile(lockfilePath, originalLockfile)
    let addCalls = 0
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      addCalls += 1
      if (addCalls === 1) {
        await writeFile(manifestPath, JSON.stringify({ dependencies: { [VISION_TOOLKIT_PACKAGE]: '0.2.0' } }))
        await writeFile(lockfilePath, 'partially-updated: true\n')
        await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
          name: VISION_TOOLKIT_PACKAGE,
          version: '0.2.0',
        }))
        return { exitCode: 1, stderr: 'late lifecycle failure' }
      }
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.1.0',
      }))
      return { stdout: 'restored\n' }
    })
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      healthUrl: 'http://127.0.0.1:3080/_dsh/vision-toolkit/settings',
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-failed' })
    expect(addCalls).toBe(2)
    expect(await readFile(manifestPath)).toEqual(originalManifest)
    expect(await readFile(lockfilePath)).toEqual(originalLockfile)
    await expect(readFile(join(fixture.profileDir, '.dsh-vision-toolkit-update.lock')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the recovery backup and lock when rollback cannot restore the installed package', async () => {
    const fixture = await profileFixture('^0.1.0')
    let addCalls = 0
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      addCalls += 1
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.2.0',
      }))
      return addCalls === 1
        ? { exitCode: 1, stderr: 'install failed after mutation' }
        : { exitCode: 1, stderr: 'rollback failed' }
    })
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web', '--port', '3080'],
      allowDetachedRestart: true,
    })

    const failure = await service.installAndRestart('0.2.0').catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'update-rollback-failed' })
    expect((failure as Error).message).toContain('recovery files preserved at')
    const lock = JSON.parse(await readFile(join(fixture.profileDir, '.dsh-vision-toolkit-update.lock'), 'utf8')) as {
      token: string
    }
    await expect(readFile(join(
      fixture.profileDir,
      `.dsh-vision-toolkit-update-backup-${lock.token}`,
      'package.json',
    ))).resolves.toBeInstanceOf(Buffer)
  })

  it('refuses to restart when pnpm did not install the exact confirmed version', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      const target = spec.argv.find(value => value.startsWith(`${VISION_TOOLKIT_PACKAGE}@`))
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: target?.endsWith('@0.1.0') === true ? '0.1.0' : '0.3.0',
      }))
      return { stdout: 'updated\n' }
    })
    const prepareRestart = vi.fn()
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      prepareRestart,
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-verify-failed' })
    expect(prepareRestart).not.toHaveBeenCalled()
  })

  it('keeps the current Web process running when the restart helper does not acknowledge handoff', async () => {
    const fixture = await profileFixture('^0.1.0')
    let addCalls = 0
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      addCalls += 1
      const version = addCalls === 1 ? '0.2.0' : '0.1.0'
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version,
      }))
      return { stdout: `${version}\n` }
    })
    const terminateCurrent = vi.fn()
    const schedule = vi.fn()
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web', '--port', '3080'],
      allowDetachedRestart: true,
      prepareRestart: async () => { throw new Error('handoff failed') },
      terminateCurrent,
      schedule,
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'restart-failed' })
    expect(addCalls).toBe(2)
    expect(schedule).not.toHaveBeenCalled()
    expect(terminateCurrent).not.toHaveBeenCalled()
    await expect(readFile(join(fixture.profileDir, '.dsh-vision-toolkit-update.lock')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('plugin restart helper', () => {
  it('rolls back and restores service when the replacement exits before becoming ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dvt-restart-helper-'))
    roots.push(root)
    const statePath = join(root, 'version.txt')
    const pidPath = join(root, 'server.pid')
    const lockPath = join(root, '.update.lock')
    const lockToken = 'restart-helper-token'
    const backupDir = join(root, '.update-backup')
    const appPath = join(root, 'fake-dsh.cjs')
    const pnpmPath = join(root, 'fake-pnpm.cjs')
    await writeFile(statePath, '0.2.0')
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: lockToken }))
    await mkdir(backupDir)
    await writeFile(join(backupDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      dependencies: { [VISION_TOOLKIT_PACKAGE]: '0.1.0' },
    }))
    await writeFile(join(backupDir, 'metadata.json'), JSON.stringify({ hadLockfile: false, manifestMode: 0o644 }))
    await writeFile(appPath, `
const { readFileSync, writeFileSync } = require('node:fs')
const { createServer } = require('node:http')
const statePath = process.argv[2]
const port = Number(process.argv[3])
const pidPath = process.argv[4]
const version = readFileSync(statePath, 'utf8').trim()
if (version === '0.2.0') process.exit(1)
const server = createServer((_req, res) => {
  const body = JSON.stringify({ ok: true, value: { release: { pluginVersion: version } } })
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) })
  res.end(body)
})
server.listen(port, '127.0.0.1', () => { writeFileSync(pidPath, String(process.pid)) })
process.on('SIGTERM', () => { server.close(() => process.exit(0)) })
`)
    await writeFile(pnpmPath, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
const target = process.argv.find(value => value.startsWith('@anionex/dsh-vision-toolkit@'))
if (!target) process.exit(1)
writeFileSync(process.env.DVT_RESTART_STATE, target.slice(target.lastIndexOf('@') + 1))
`)
    await chmod(pnpmPath, 0o755)

    const probe = createServer()
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', resolve)
    })
    const address = probe.address()
    if (address === null || typeof address === 'string') throw new Error('probe did not bind')
    const port = address.port
    await new Promise<void>(resolve => { probe.close(() => { resolve() }) })

    const payload = Buffer.from(JSON.stringify({
      pid: 999_999,
      execPath: process.execPath,
      args: [appPath, statePath, String(port), pidPath],
      cwd: root,
      logPath: join(root, 'restart.log'),
      lockPath,
      lockToken,
      backupDir,
      handoffPath: join(backupDir, 'handoff.json'),
      profileDir: root,
      pnpmPath,
      packageName: VISION_TOOLKIT_PACKAGE,
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      healthUrl: `http://127.0.0.1:${port}/_dsh/vision-toolkit/settings`,
      rollbackTimeoutMs: 5_000,
      processKillGraceMs: 100,
      readinessTimeoutMs: 5_000,
      oldProcessExitTimeoutMs: 1_000,
    })).toString('base64url')
    const helper = spawn(process.execPath, ['-e', PLUGIN_RESTART_HELPER_SOURCE, payload], {
      cwd: root,
      env: { ...process.env, DVT_RESTART_STATE: statePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    helper.stderr?.on('data', chunk => { stderr += String(chunk) })
    const [code] = await once(helper, 'exit') as [number | null]
    expect(code, stderr).toBe(2)
    expect(await readFile(statePath, 'utf8')).toBe('0.1.0')
    await vi.waitFor(async () => {
      expect(Number(await readFile(pidPath, 'utf8'))).toBeGreaterThan(0)
    })
    const restored = await fetch(`http://127.0.0.1:${port}/_dsh/vision-toolkit/settings`)
    await expect(restored.json()).resolves.toMatchObject({
      ok: true,
      value: { release: { pluginVersion: '0.1.0' } },
    })
    const restoredPid = Number(await readFile(pidPath, 'utf8'))
    process.kill(restoredPid, 'SIGTERM')
    await vi.waitFor(async () => {
      await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
    await expect(readFile(join(backupDir, 'metadata.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the helper-owned profile lock and times out a hung rollback pnpm process', async () => {
    const fixture = await profileFixture()
    const root = dirname(dirname(fixture.profileDir))
    const statePath = join(root, 'version.txt')
    const lockPath = join(fixture.profileDir, '.dsh-vision-toolkit-update.lock')
    const lockToken = 'handoff-token'
    const backupDir = join(fixture.profileDir, '.update-backup')
    const appPath = join(root, 'exit-immediately.cjs')
    const pnpmPath = join(root, 'hung-pnpm.cjs')
    const originalManifest = await readFile(join(fixture.profileDir, 'package.json'))
    await writeFile(statePath, '0.2.0')
    await writeFile(lockPath, JSON.stringify({ pid: 999_999, token: lockToken }))
    await mkdir(backupDir)
    await writeFile(join(backupDir, 'package.json'), originalManifest)
    await writeFile(join(backupDir, 'metadata.json'), JSON.stringify({ hadLockfile: false, manifestMode: 0o644 }))
    await writeFile(appPath, 'process.exit(1)\n')
    await writeFile(pnpmPath, `#!/bin/sh
trap '' TERM
while :; do sleep 1; done
`)
    await chmod(pnpmPath, 0o755)

    const payload = Buffer.from(JSON.stringify({
      pid: 999_999,
      execPath: process.execPath,
      args: [appPath],
      cwd: root,
      logPath: join(root, 'restart.log'),
      lockPath,
      lockToken,
      backupDir,
      handoffPath: join(backupDir, 'handoff.json'),
      profileDir: fixture.profileDir,
      pnpmPath,
      packageName: VISION_TOOLKIT_PACKAGE,
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      healthUrl: 'http://127.0.0.1:1/_dsh/vision-toolkit/settings',
      rollbackTimeoutMs: 100,
      processKillGraceMs: 50,
      readinessTimeoutMs: 100,
      oldProcessExitTimeoutMs: 100,
    })).toString('base64url')
    const helper = spawn(process.execPath, ['-e', PLUGIN_RESTART_HELPER_SOURCE, payload], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    helper.stderr?.on('data', chunk => { stderr += String(chunk) })

    await vi.waitFor(async () => {
      const owner = JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number; token: string }
      expect(owner).toMatchObject({ pid: helper.pid, token: lockToken })
    })
    const secondSubprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const second = new VisionToolkitPluginUpdateService(host(secondSubprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      allowDetachedRestart: true,
      healthUrl: 'http://127.0.0.1:3080/_dsh/vision-toolkit/settings',
    })
    await expect(second.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-in-progress' })
    expect(secondSubprocess.spawns).toHaveLength(0)

    const [code] = await once(helper, 'exit') as [number | null]
    expect(code, stderr).toBe(1)
    expect(stderr).toContain('rollback pnpm timed out')
    expect(await readFile(join(fixture.profileDir, 'package.json'))).toEqual(originalManifest)
    await expect(readFile(lockPath, 'utf8')).resolves.toContain(lockToken)
    await expect(readFile(join(backupDir, 'package.json'))).resolves.toEqual(originalManifest)
  })
})
