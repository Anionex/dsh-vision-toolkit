import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { createPathPolicy, resolveInputFile, workspaceStorageId } from '../src/paths.ts'
import { assertWindowsFallbackDirectory, assertWindowsFallbackFile, findWindowsFallbackStorage } from '../src/windows-fallback-storage.ts'

const execFileAsync = promisify(execFile)

async function addAccessRule(directory: string, rights: string, type: 'Allow' | 'Deny'): Promise<void> {
  const principal = type === 'Deny'
    ? '([Security.Principal.WindowsIdentity]::GetCurrent()).User'
    : '[Security.Principal.SecurityIdentifier]::new("S-1-1-0")'
  const script = `
$ErrorActionPreference = 'Stop'
$path = $env:DSH_WINDOWS_STORAGE_TEST_PATH
$acl = [IO.Directory]::GetAccessControl($path)
$sid = ${principal}
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, '${rights}', '${type}')
$acl.AddAccessRule($rule)
[IO.Directory]::SetAccessControl($path, $acl)
`
  await execFileAsync(join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? '', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { env: { ...process.env, DSH_WINDOWS_STORAGE_TEST_PATH: directory }, windowsHide: true, timeout: 10_000 })
}

describe.skipIf(process.platform !== 'win32')('Windows private fallback storage', () => {
  it('falls back when an existing local storage folder loses write access, then reads its artifacts without using it for new output', async () => {
    const workspace = await realpath(await mkdtemp(join(tmpdir(), 'vision-fallback-workspace-')))
    const id = workspaceStorageId(workspace, 'windows-local-app-data')
    const local = join(workspace, '.dsh-vision-toolkit')
    const options = { windowsWorkspaceFallback: true }
    let fallback: string | undefined
    try {
      await mkdir(local)
      await addAccessRule(local, 'CreateDirectories', 'Deny')
      const activated = await createPathPolicy(workspace, [], undefined, [], options)
      fallback = activated.storageRoot
      expect(fallback).not.toBe(await realpath(local))
      expect(fallback).toBe(await findWindowsFallbackStorage(id, false))
      const artifact = join(activated.outputDir, 'fallback.png')
      await writeFile(artifact, 'fixture')

      // Replace the controlled denied directory with a newly writable one.
      await rm(local, { recursive: true })
      const writable = await createPathPolicy(workspace, [], undefined, [], options)
      expect(writable.storageRoot).toBe(await realpath(local))
      expect(writable.allowedDirs).toContain(fallback)
      expect(await resolveInputFile(artifact, writable)).toEqual({ path: await realpath(artifact), bytes: 7 })

      const optedOut = await createPathPolicy(workspace, [])
      expect(optedOut.allowedDirs).not.toContain(fallback)
      await expect(resolveInputFile(artifact, optedOut)).rejects.toMatchObject({ code: 'path' })
    } finally {
      if (fallback !== undefined && fallback !== local) await rm(dirname(fallback), { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  }, 30_000)

  it('refuses a Windows ACL that lets another principal read private storage', async () => {
    const id = randomBytes(10).toString('hex')
    const root = (await findWindowsFallbackStorage(id, true))!
    try {
      const session = join(root, 'tmp', 'pasted-images', 'test-session')
      await mkdir(session, { recursive: true })
      await expect(assertWindowsFallbackDirectory(root, session)).resolves.toBeUndefined()
      await addAccessRule(session, 'Read', 'Allow')
      await expect(assertWindowsFallbackDirectory(root, session)).rejects.toMatchObject({ code: 'path' })
      await addAccessRule(root, 'Read', 'Allow')
      await expect(findWindowsFallbackStorage(id, false)).rejects.toMatchObject({ code: 'path' })
      await expect(findWindowsFallbackStorage(id, true)).rejects.toMatchObject({ code: 'path' })
    } finally {
      await rm(dirname(root), { recursive: true, force: true })
    }
  }, 30_000)

  it('refuses reads through a junction even when its target is in private storage', async () => {
    const id = randomBytes(10).toString('hex')
    const root = (await findWindowsFallbackStorage(id, true))!
    try {
      const artifacts = join(root, 'artifacts')
      const real = join(artifacts, 'real')
      const alias = join(artifacts, 'alias')
      await mkdir(real, { recursive: true })
      const file = join(real, 'output.png')
      await writeFile(file, 'fixture')
      await symlink(real, alias, 'junction')
      await expect(assertWindowsFallbackFile(root, file)).resolves.toBeUndefined()
      await expect(assertWindowsFallbackFile(root, join(alias, 'output.png'))).rejects.toMatchObject({ code: 'path' })
    } finally {
      await rm(dirname(root), { recursive: true, force: true })
    }
  }, 30_000)
})
