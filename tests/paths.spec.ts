import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  commitStagedOutput,
  commitStagedDirectory,
  createPathPolicy,
  createStagedDirectory,
  createStagedOutput,
  normalizePlatformTempPath,
  platformTempDirectory,
  preflightSharedStorageBase,
  resolveHtmlFile,
  resolveInputFile,
  resolveOutputDirectory,
  resolveOutputFile,
  seedStagedDirectory,
  workspaceStorageId,
} from '../src/paths.ts'
import { VisionToolkitError } from '../src/errors.ts'

const tempDirs: string[] = []
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-vision-toolkit-${prefix}-`))
  tempDirs.push(dir)
  return dir
}

async function outsideTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(homedir(), `.dsh-vision-toolkit-${prefix}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => import('node:fs/promises').then(fs => fs.rm(dir, { recursive: true, force: true }))))
})

describe('createPathPolicy', () => {
  it('names shared workspace storage separately for each user identity', () => {
    const workspace = '/fixture/workspace'

    expect(workspaceStorageId(workspace, 'uid:1000')).not.toBe(workspaceStorageId(workspace, 'uid:1001'))
    expect(workspaceStorageId(workspace, 'uid:1000')).toMatch(/^[a-f0-9]{20}$/u)
  })

  it('rejects configured shared storage when POSIX ownership checks are unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'geteuid')
    Object.defineProperty(process, 'geteuid', { configurable: true, value: undefined })
    try {
      await expect(preflightSharedStorageBase(join(tmpdir(), 'dsh-vision-toolkit-unsupported')))
        .rejects.toThrow('ownership and permissions cannot be verified')
    } finally {
      if (descriptor === undefined) delete (process as { geteuid?: unknown }).geteuid
      else Object.defineProperty(process, 'geteuid', descriptor)
    }
  })

  it.skipIf(typeof process.geteuid !== 'function')('write-probes a shared base without leaving preflight directories behind', async () => {
    const shared = join(await outsideTempDir('preflight-parent'), 'shared')

    await expect(preflightSharedStorageBase(shared)).resolves.toBe(await realpath(shared))
    expect((await readdir(shared)).filter(name => name.startsWith('.dsh-vision-toolkit-preflight-'))).toEqual([])
  })

  it.skipIf(typeof process.geteuid !== 'function')('rejects relative or non-directory shared storage roots during preflight', async () => {
    const parent = await outsideTempDir('preflight-invalid')
    const file = join(parent, 'storage-file')
    await writeFile(file, 'fixture')

    await expect(preflightSharedStorageBase('relative/storage')).rejects.toMatchObject({ code: 'path' })
    await expect(preflightSharedStorageBase(file)).rejects.toMatchObject({ code: 'path' })
  })

  it('creates the plugin output directory inside the workspace', async () => {
    const workspace = await tempDir('workspace')
    const policy = await createPathPolicy(workspace, [])
    expect(policy.workspace).toBe(await realpath(workspace))
    expect(policy.storageRoot).toBe(await realpath(join(workspace, '.dsh-vision-toolkit')))
    expect(policy.outputDir).toBe(await realpath(join(workspace, '.dsh-vision-toolkit', 'artifacts')))
  })

  it.skipIf(typeof process.geteuid !== 'function')('uses a stable workspace-specific child below a configured shared root', async () => {
    const workspace = await tempDir('workspace')
    const shared = await outsideTempDir('shared')
    const policy = await createPathPolicy(workspace, [], shared)
    const canonicalWorkspace = await realpath(workspace)
    const expectedRoot = join(await realpath(shared), workspaceStorageId(canonicalWorkspace))

    expect(policy.storageRoot).toBe(expectedRoot)
    expect(policy.outputDir).toBe(join(expectedRoot, 'artifacts'))
    expect(policy.allowedDirs).toContain(expectedRoot)
    await expect(lstat(join(workspace, '.dsh-vision-toolkit'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await createPathPolicy(workspace, [], shared)).storageRoot).toBe(expectedRoot)
  })

  it.skipIf(typeof process.geteuid !== 'function')('retains only the same workspace child from a previous shared storage root', async () => {
    const workspace = await tempDir('workspace')
    const previousShared = await outsideTempDir('previous-shared')
    const currentShared = await outsideTempDir('current-shared')
    const previousPolicy = await createPathPolicy(workspace, [], previousShared)
    const persisted = join(previousPolicy.storageRoot, 'persisted.png')
    await writeFile(persisted, 'fixture')
    const sibling = join(previousShared, 'another-workspace')
    await mkdir(sibling, { mode: 0o700 })
    const siblingImage = join(sibling, 'private.png')
    await writeFile(siblingImage, 'fixture')

    const policy = await createPathPolicy(workspace, [], currentShared, [previousShared])

    await expect(resolveInputFile(persisted, policy)).resolves.toMatchObject({ path: await realpath(persisted) })
    await expect(resolveInputFile(siblingImage, policy)).rejects.toMatchObject({ code: 'path' })
    expect(policy.allowedDirs).toContain(previousPolicy.storageRoot)
    expect(policy.allowedDirs).not.toContain(await realpath(previousShared))
  })

  it.skipIf(typeof process.geteuid !== 'function')('drops a previous workspace storage child that becomes unsafe', async () => {
    const workspace = await tempDir('workspace')
    const previousShared = await outsideTempDir('previous-unsafe')
    const currentShared = await outsideTempDir('current-safe')
    const previousPolicy = await createPathPolicy(workspace, [], previousShared)
    const persisted = join(previousPolicy.storageRoot, 'persisted.png')
    await writeFile(persisted, 'fixture')
    await chmod(previousPolicy.storageRoot, 0o777)

    const policy = await createPathPolicy(workspace, [], currentShared, [previousShared])

    expect(policy.allowedDirs).not.toContain(previousPolicy.storageRoot)
    await expect(resolveInputFile(persisted, policy)).rejects.toMatchObject({ code: 'path' })
  })

  it.skipIf(typeof process.geteuid !== 'function')('rejects a pre-created shared workspace directory with unsafe permissions', async () => {
    const workspace = await tempDir('workspace')
    const shared = await outsideTempDir('shared')
    const child = join(shared, workspaceStorageId(await realpath(workspace)))
    await mkdir(child, { mode: 0o700 })
    await chmod(child, 0o777)

    await expect(createPathPolicy(workspace, [], shared)).rejects.toMatchObject({ code: 'path' })
  })

  it.skipIf(typeof process.geteuid !== 'function')('rejects a sticky shared base not owned by the current user or root', async () => {
    const workspace = await tempDir('workspace')
    const shared = await outsideTempDir('shared')
    await chmod(shared, 0o1777)
    const actualUid = process.geteuid()
    vi.spyOn(process, 'geteuid').mockReturnValue(actualUid + 1)

    await expect(createPathPolicy(workspace, [], shared)).rejects.toMatchObject({ code: 'path' })
  })

  it.skipIf(typeof process.geteuid !== 'function')('rejects a configured shared storage base that is a symbolic link', async () => {
    const workspace = await tempDir('workspace')
    const target = await outsideTempDir('shared-target')
    const parent = await outsideTempDir('shared-link-parent')
    const sharedLink = join(parent, 'shared-link')
    await symlink(target, sharedLink)

    await expect(createPathPolicy(workspace, [], sharedLink)).rejects.toMatchObject({ code: 'path' })
  })

  it.skipIf(typeof process.geteuid !== 'function')('rejects an intermediate user-controlled symbolic link in the configured path', async () => {
    const workspace = await tempDir('workspace')
    const target = await outsideTempDir('shared-target')
    const parent = await outsideTempDir('shared-alias-parent')
    const alias = join(parent, 'alias')
    await symlink(target, alias)

    await expect(createPathPolicy(workspace, [], join(alias, 'shared'))).rejects.toMatchObject({ code: 'path' })
  })

  it.skipIf(typeof process.geteuid !== 'function')('accepts the root-owned platform /tmp alias as a shared storage base', async () => {
    const workspace = await tempDir('workspace')
    const policy = await createPathPolicy(workspace, [], '/tmp')
    tempDirs.push(policy.storageRoot)

    expect(policy.storageRoot).toBe(join(await realpath('/tmp'), workspaceStorageId(await realpath(workspace))))
  })

  it.skipIf(typeof process.geteuid !== 'function')('rejects a private shared base below a replaceable parent directory', async () => {
    const workspace = await tempDir('workspace')
    const parent = await outsideTempDir('replaceable-parent')
    const shared = join(parent, 'shared')
    await mkdir(shared, { mode: 0o700 })
    await chmod(parent, 0o777)

    await expect(createPathPolicy(workspace, [], shared)).rejects.toMatchObject({ code: 'path' })
  })

  it('resolves and realpaths allowedDirs', async () => {
    const workspace = await tempDir('workspace')
    const allowed = await tempDir('allowed')
    const policy = await createPathPolicy(workspace, [allowed])
    expect(policy.allowedDirs).toContain(await realpath(allowed))
  })

  it('includes the platform temporary directory in the input fence', async () => {
    const workspace = await tempDir('workspace')
    const policy = await createPathPolicy(workspace, [])
    expect(policy.tempDir).toBe(await realpath(platformTempDirectory()))
    expect(policy.allowedDirs).toContain(policy.tempDir)
  })
})

describe('platform temporary paths', () => {
  it('maps model-generated POSIX temp paths to Windows TEMP', () => {
    expect(platformTempDirectory('win32', { TEMP: 'C:\\Users\\tester\\AppData\\Local\\Temp' } as NodeJS.ProcessEnv))
      .toBe('C:\\Users\\tester\\AppData\\Local\\Temp')
    expect(normalizePlatformTempPath(
      '/tmp/screenshot.png',
      'win32',
      'C:\\Users\\tester\\AppData\\Local\\Temp',
    )).toBe('C:\\Users\\tester\\AppData\\Local\\Temp\\screenshot.png')
    expect(normalizePlatformTempPath('/tmp', 'win32', 'C:\\Temp'))
      .toBe('C:\\Temp')
    expect(platformTempDirectory('win32', { TEMP: ' ', TMP: 'D:\\Temp' } as NodeJS.ProcessEnv))
      .toBe('D:\\Temp')
    expect(normalizePlatformTempPath('/tmp-file.png', 'win32', 'C:\\Temp'))
      .toBe('/tmp-file.png')
  })

  it('does not rewrite POSIX temp paths on POSIX platforms', () => {
    expect(platformTempDirectory('linux')).toBe('/tmp')
    expect(normalizePlatformTempPath('/tmp/screenshot.png', 'linux', '/var/tmp'))
      .toBe('/tmp/screenshot.png')
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

  it('accepts an image in the platform temporary directory', async () => {
    const workspace = await tempDir('workspace')
    const temporary = await mkdtemp(join(platformTempDirectory(), 'dsh-vision-toolkit-platform-temp-'))
    tempDirs.push(temporary)
    const path = join(temporary, 'temporary.png')
    await writeFile(path, 'data')
    const policy = await createPathPolicy(workspace, [])
    const input = process.platform === 'win32'
      ? `/tmp/${basename(temporary)}/temporary.png`
      : path
    const image = await resolveInputFile(input, policy)
    expect(image.path).toBe(await realpath(path))
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
    const outside = await outsideTempDir('outside')
    await writeFile(join(outside, 'x.png'), 'data')
    const policy = await createPathPolicy(workspace, [])
    await expect(resolveInputFile('../x.png', policy)).rejects.toMatchObject({ code: 'input' })
    await expect(resolveInputFile(join(outside, 'x.png'), policy)).rejects.toMatchObject({ code: 'path' })
  })

  it('rejects a symlink whose real target escapes the fence', async () => {
    const workspace = await tempDir('workspace')
    const outside = await outsideTempDir('outside')
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
    const outside = await outsideTempDir('outside')
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

describe('managed artifact directories', () => {
  it('accepts local HTML but rejects URL-shaped and wrong-extension sources', async () => {
    const workspace = await tempDir('workspace')
    await writeFile(join(workspace, 'page.html'), '<!doctype html>\n')
    await writeFile(join(workspace, 'page.txt'), 'text\n')
    const policy = await createPathPolicy(workspace, [])
    expect((await resolveHtmlFile('page.html', policy)).path).toBe(await realpath(join(workspace, 'page.html')))
    await expect(resolveHtmlFile('https://example.com', policy)).rejects.toMatchObject({ code: 'input' })
    await expect(resolveHtmlFile('page.txt', policy)).rejects.toMatchObject({ code: 'input' })
  })

  it('commits complete run directories and seeds an explicit resume staging area', async () => {
    const workspace = await tempDir('workspace')
    const policy = await createPathPolicy(workspace, [])
    const finalPath = resolveOutputDirectory('run-one', policy, 'default-run')
    const staged = await createStagedDirectory(policy)
    await writeFile(join(staged, 'result.json'), '{"ok":true}\n')
    await commitStagedDirectory(staged, finalPath, policy)
    expect(await readFile(join(finalPath, 'result.json'), 'utf8')).toContain('true')

    const resume = await createStagedDirectory(policy)
    expect(await seedStagedDirectory(finalPath, resume, policy)).toBe(true)
    expect(await readFile(join(resume, 'result.json'), 'utf8')).toContain('true')
  })

  it('restores the previous run only from a real managed directory', async () => {
    const workspace = await tempDir('workspace')
    const outside = await outsideTempDir('outside')
    const policy = await createPathPolicy(workspace, [])
    const finalPath = resolveOutputDirectory('run-link', policy, 'default-run')
    await symlink(outside, finalPath)
    const staged = await createStagedDirectory(policy)
    await expect(seedStagedDirectory(finalPath, staged, policy)).rejects.toMatchObject({ code: 'path' })
  })

  it('rejects symbolic links anywhere inside a staged run directory', async () => {
    const workspace = await tempDir('workspace')
    const outside = await outsideTempDir('outside')
    const policy = await createPathPolicy(workspace, [])
    const staged = await createStagedDirectory(policy)
    await writeFile(join(outside, 'secret.txt'), 'secret\n')
    await symlink(join(outside, 'secret.txt'), join(staged, 'result.txt'))
    const finalPath = resolveOutputDirectory('unsafe-run', policy, 'default-run')
    await expect(commitStagedDirectory(staged, finalPath, policy)).rejects.toMatchObject({ code: 'path' })
  })

  it('rejects nested, absolute, and reserved artifact directory names', async () => {
    const workspace = await tempDir('workspace')
    const policy = await createPathPolicy(workspace, [])
    expect(() => resolveOutputDirectory('../run', policy, 'default')).toThrowError(/one visible directory name/)
    expect(() => resolveOutputDirectory('/tmp/run', policy, 'default')).toThrowError(/absolute/)
    expect(() => resolveOutputDirectory('.vision-toolkit-owned', policy, 'default')).toThrowError(/one visible directory name/)
  })
})
