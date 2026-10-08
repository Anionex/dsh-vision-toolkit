import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import { resolveConfig } from '../src/config.ts'
import { createPathPolicy, resolveWorkspaceStorage } from '../src/paths.ts'
import { VisionToolkitRuntime } from '../src/runtime.ts'
import { UpstreamAdapter } from '../src/upstream.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, mkdir: vi.fn(actual.mkdir) }
})

const tempDirs: string[] = []
const contexts: Context[] = []
const signal = new AbortController().signal
const fixture = fileURLToPath(new URL('./fixtures/upstream', import.meta.url))

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-vision-toolkit-storage-errors-'))
  tempDirs.push(dir)
  return dir
}

async function runtime(): Promise<{ runtime: VisionToolkitRuntime; adapter: UpstreamAdapter }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSubprocessService)
  const config = resolveConfig({ runtime: { mode: 'external', agentVisionToolkitPath: fixture, python: 'python3' } })
  const adapter = new UpstreamAdapter(ctx, config, {
    source: 'external', root: fixture,
    python: { program: 'python3', prefix: [], display: 'python3' },
    cleanHome: fixture, pythonVersion: '3.11+', dependencies: {},
  })
  return { runtime: new VisionToolkitRuntime(ctx, config, adapter), adapter }
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(mkdir).mockClear()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('workspace-local storage failures', () => {
  it.each(['EACCES', 'EPERM', 'EROFS'])('gives actionable guidance for %s without creating a fallback root', async (code) => {
    const dir = await workspace()
    const cause = Object.assign(new Error('controlled filesystem denial'), { code })
    vi.mocked(mkdir).mockRejectedValueOnce(cause)

    await expect(createPathPolicy(dir, [])).rejects.toMatchObject({
      code: 'path', cause,
      message: expect.stringContaining('Choose a session workspace writable by the current user and retry'),
    })
    expect(mkdir).toHaveBeenCalledTimes(1)
    expect(mkdir).toHaveBeenCalledWith(join(dir, '.dsh-vision-toolkit'), { mode: 0o700 })
    expect(await readdir(dir)).toEqual([])
  })

  it('does not relabel unrelated filesystem failures as permissions problems', async () => {
    const dir = await workspace()
    const cause = Object.assign(new Error('controlled disk capacity failure'), { code: 'ENOSPC' })
    vi.mocked(mkdir).mockRejectedValueOnce(cause)

    await expect(resolveWorkspaceStorage(dir)).rejects.toMatchObject({
      code: 'path', cause,
      message: `plugin storage directory is not writable: ${join(dir, '.dsh-vision-toolkit')}`,
    })
  })

  it('propagates read-only guidance through a real runtime operation before upstream execution', async () => {
    const dir = await workspace()
    const { runtime: toolkit, adapter } = await runtime()
    const run = vi.spyOn(adapter, 'run')
    vi.mocked(mkdir).mockRejectedValueOnce(Object.assign(new Error('controlled read-only filesystem'), { code: 'EROFS' }))

    await expect(toolkit.crop({ image: 'sample.png', region: '0,0,10,10' }, { signal, workspace: dir }))
      .rejects.toMatchObject({ code: 'path', message: expect.stringContaining('Choose a session workspace writable') })
    expect(run).not.toHaveBeenCalled()
    expect(await readdir(dir)).toEqual([])
  })

  it('keeps writable workspace execution available without POSIX ownership APIs', async () => {
    const dir = await workspace()
    await copyFile(fileURLToPath(new URL('./fixtures/sample.png', import.meta.url)), join(dir, 'sample.png'))
    const { runtime: toolkit } = await runtime()
    const descriptor = Object.getOwnPropertyDescriptor(process, 'geteuid')
    Object.defineProperty(process, 'geteuid', { configurable: true, value: undefined })
    try {
      const result = await toolkit.crop({ image: 'sample.png', region: '10,20,50,40' }, { signal, workspace: dir })
      expect(result).toMatchObject({ width: 40, height: 20, mimeType: 'image/png' })
      expect(result.outputPath).toContain(join(await realpath(dir), '.dsh-vision-toolkit', 'artifacts'))
      expect((await readFile(result.outputPath)).length).toBeGreaterThan(0)
      await expect(resolveWorkspaceStorage(dir, join(dir, 'shared')))
        .rejects.toThrow('ownership and permissions cannot be verified')
      expect(await readdir(dir)).not.toContain('shared')
    } finally {
      if (descriptor === undefined) delete (process as { geteuid?: unknown }).geteuid
      else Object.defineProperty(process, 'geteuid', descriptor)
    }
  })
})
