import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compareVersions,
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
    })

    await expect(service.capability()).resolves.toEqual({
      supported: false,
      profile: 'web',
      dependencySpec: 'link:/workspace/dsh-vision-toolkit',
      reason: 'unsupported-install-source',
    })
    expect(subprocess.resolveExecutable).not.toHaveBeenCalled()
  })

  it('checks the configured registry through pnpm without mutating the profile', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async () => ({ stdout: '"0.2.0"\n' }))
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
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
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-stale' })
    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-stale' })
    expect(subprocess.spawns).toHaveLength(2)
  })

  it('refuses to restart when pnpm did not install the exact confirmed version', async () => {
    const fixture = await profileFixture()
    const subprocess = new FakeSubprocess(async (spec) => {
      if (spec.argv.includes('view')) return { stdout: '"0.2.0"\n' }
      await writeFile(join(fixture.installedDir, 'package.json'), JSON.stringify({
        name: VISION_TOOLKIT_PACKAGE,
        version: '0.3.0',
      }))
      return { stdout: 'updated\n' }
    })
    const prepareRestart = vi.fn()
    const service = new VisionToolkitPluginUpdateService(host(subprocess), '0.1.0', {
      profileDir: fixture.profileDir,
      packageRoot: fixture.installedDir,
      argv: ['web'],
      prepareRestart,
    })

    await expect(service.installAndRestart('0.2.0')).rejects.toMatchObject({ code: 'update-verify-failed' })
    expect(prepareRestart).not.toHaveBeenCalled()
  })
})
