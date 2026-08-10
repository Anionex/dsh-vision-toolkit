import { lstat, mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  commitStagedOutput,
  createPathPolicy,
  createStagedOutput,
  resolveInputFile,
  resolveOutputFile,
} from '../src/paths.ts'
import { VisionToolkitError } from '../src/errors.ts'

const tempDirs: string[] = []
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-vision-toolkit-${prefix}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => import('node:fs/promises').then(fs => fs.rm(dir, { recursive: true, force: true }))))
})

describe('createPathPolicy', () => {
  it('creates the plugin output directory inside the workspace', async () => {
    const workspace = await tempDir('workspace')
    const policy = await createPathPolicy(workspace, [])
    expect(policy.workspace).toBe(await realpath(workspace))
    expect(policy.outputDir).toBe(await realpath(join(workspace, '.dsh-vision-toolkit', 'artifacts')))
  })

  it('rejects an output directory outside the fence', async () => {
    const workspace = await tempDir('workspace')
    const outside = await tempDir('outside')
    await expect(createPathPolicy(workspace, [], join(outside, 'out')))
      .rejects.toMatchObject({ code: 'path' })
  })

  it('resolves and realpaths allowedDirs', async () => {
    const workspace = await tempDir('workspace')
    const allowed = await tempDir('allowed')
    const policy = await createPathPolicy(workspace, [allowed])
    expect(policy.allowedDirs).toContain(await realpath(allowed))
  })
})

describe('resolveInputFile', () => {
  it('accepts a workspace image and reports bytes', async () => {
    const workspace = await tempDir('workspace')
    await writeFile(join(workspace, 'a.png'), 'data')
    const policy = await createPathPolicy(workspace, [])
    const image = await resolveInputFile('a.png', policy)
    expect(image.path).toBe(await realpath(join(workspace, 'a.png')))
    expect(image.bytes).toBe(4)
  })

  it('accepts an image inside an allowedDir', async () => {
    const workspace = await tempDir('workspace')
    const allowed = await tempDir('allowed')
    await writeFile(join(allowed, 'b.webp'), 'data')
    const policy = await createPathPolicy(workspace, [allowed])
    const image = await resolveInputFile(join(allowed, 'b.webp'), policy)
    expect(image.path).toBe(await realpath(join(allowed, 'b.webp')))
  })

  it('rejects missing files, directories, and unsupported extensions', async () => {
    const workspace = await tempDir('workspace')
    await mkdir(join(workspace, 'dir.png'))
    await writeFile(join(workspace, 'doc.txt'), 'x')
    const policy = await createPathPolicy(workspace, [])
    await expect(resolveInputFile('missing.png', policy)).rejects.toMatchObject({ code: 'input' })
    await expect(resolveInputFile('dir.png', policy)).rejects.toMatchObject({ code: 'input' })
    await expect(resolveInputFile('doc.txt', policy)).rejects.toMatchObject({ code: 'input' })
  })

  it('rejects traversal and absolute escapes', async () => {
    const workspace = await tempDir('workspace')
    const outside = await tempDir('outside')
    await writeFile(join(outside, 'x.png'), 'data')
    const policy = await createPathPolicy(workspace, [])
    await expect(resolveInputFile('../x.png', policy)).rejects.toMatchObject({ code: 'input' })
    await expect(resolveInputFile(join(outside, 'x.png'), policy)).rejects.toMatchObject({ code: 'path' })
  })

  it('rejects a symlink whose real target escapes the fence', async () => {
    const workspace = await tempDir('workspace')
    const outside = await tempDir('outside')
    await writeFile(join(outside, 'secret.png'), 'data')
    await symlink(join(outside, 'secret.png'), join(workspace, 'link.png'))
    const policy = await createPathPolicy(workspace, [])
    await expect(resolveInputFile('link.png', policy)).rejects.toMatchObject({ code: 'path' })
  })

  it('allows a symlink whose real target stays inside the fence', async () => {
    const workspace = await tempDir('workspace')
    await writeFile(join(workspace, 'real.png'), 'data')
    await symlink(join(workspace, 'real.png'), join(workspace, 'link.png'))
    const policy = await createPathPolicy(workspace, [])
    const image = await resolveInputFile('link.png', policy)
    expect(image.path).toBe(await realpath(join(workspace, 'real.png')))
  })
})

describe('resolveOutputFile', () => {
  it('defaults into the plugin output directory with the given name', async () => {
    const workspace = await tempDir('workspace')
    const policy = await createPathPolicy(workspace, [])
    const output = resolveOutputFile('out.svg', policy, 'default.svg', ['.svg'])
    expect(output).toBe(join(policy.outputDir, 'out.svg'))
    const fallback = resolveOutputFile(undefined, policy, 'default.svg', ['.svg'])
    expect(fallback).toBe(join(policy.outputDir, 'default.svg'))
  })

  it('rejects absolute paths, nested names, traversal, and wrong extensions', async () => {
    const workspace = await tempDir('workspace')
    const policy = await createPathPolicy(workspace, [])
    expect(() => resolveOutputFile('/tmp/x.svg', policy, 'd.svg', ['.svg'])).toThrowError(/absolute/)
    expect(() => resolveOutputFile('../x.svg', policy, 'd.svg', ['.svg'])).toThrowError(/one filename/)
    expect(() => resolveOutputFile('nested/x.svg', policy, 'd.svg', ['.svg'])).toThrowError(/one filename/)
    expect(() => resolveOutputFile('x.png', policy, 'd.svg', ['.svg'])).toThrowError(/must use one of/)
  })

  it('commits a random staging file into the final name', async () => {
    const workspace = await tempDir('workspace')
    const policy = await createPathPolicy(workspace, [])
    const staged = createStagedOutput(policy, '.svg')
    const finalPath = resolveOutputFile('result.svg', policy, 'default.svg', ['.svg'])
    await writeFile(staged, '<svg/>\n')
    await commitStagedOutput(staged, finalPath, policy)
    expect(await readFile(finalPath, 'utf8')).toBe('<svg/>\n')
  })

  it('replaces a destination symlink itself without writing through it', async () => {
    const workspace = await tempDir('workspace')
    const outside = await tempDir('outside')
    const protectedPath = join(outside, 'protected.svg')
    await writeFile(protectedPath, 'outside\n')
    const policy = await createPathPolicy(workspace, [])
    const finalPath = resolveOutputFile('result.svg', policy, 'default.svg', ['.svg'])
    await symlink(protectedPath, finalPath)
    const staged = createStagedOutput(policy, '.svg')
    await writeFile(staged, '<svg/>\n')
    await commitStagedOutput(staged, finalPath, policy)
    expect((await lstat(finalPath)).isSymbolicLink()).toBe(false)
    expect(await readFile(finalPath, 'utf8')).toBe('<svg/>\n')
    expect(await readFile(protectedPath, 'utf8')).toBe('outside\n')
  })
})
