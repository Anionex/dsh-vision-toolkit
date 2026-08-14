import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessService } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { resolveConfig } from '../src/config.ts'
import { bundledUpstreamRoot, prepareUpstreamRuntime } from '../src/runtime-install.ts'

class ProbeSubprocessService extends SubprocessService {
  readonly spawns: SubprocessSpawnSpec[] = []

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const command = spec.argv.join('\n')
    const isMetadata = command.includes('sys.version_info')
    const isDependencies = command.includes('import PIL')
    const stdout = isMetadata
      ? '{"version":"3.12.0","major":3,"minor":12}\n'
      : isDependencies
        ? '{"pillow":"12.3.0","numpy":"2.5.1","vtracer":"0.6.15"}\n'
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
      dependencies: { pillow: '12.3.0', numpy: '2.5.1', vtracer: '0.6.15' },
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
