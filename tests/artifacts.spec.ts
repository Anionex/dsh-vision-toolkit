import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeArtifact } from '../src/artifacts.ts'
import { createPathPolicy } from '../src/paths.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('describeArtifact', () => {
  it('returns the stable managed-file descriptor', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-vision-artifact-'))
    tempDirs.push(workspace)
    const policy = await createPathPolicy(workspace, [])
    const path = join(policy.outputDir, 'result.json')
    await writeFile(path, '{"ok":true}\n')
    await expect(describeArtifact(path, policy, {
      mimeType: 'application/json',
      kind: 'json',
      description: 'Fixture report',
      sourceTool: 'vision_fixture',
      previewIntent: 'text',
    })).resolves.toEqual({
      path,
      filename: 'result.json',
      mimeType: 'application/json',
      kind: 'json',
      description: 'Fixture report',
      sourceTool: 'vision_fixture',
      previewIntent: 'text',
      bytes: 12,
    })
  })

  it('rejects symlink artifacts even when their target is in the managed root', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-vision-artifact-'))
    tempDirs.push(workspace)
    const policy = await createPathPolicy(workspace, [])
    const target = join(policy.outputDir, 'target.txt')
    const link = join(policy.outputDir, 'link.txt')
    await writeFile(target, 'data\n')
    await symlink(target, link)
    await expect(describeArtifact(link, policy, {
      mimeType: 'text/plain',
      kind: 'markdown',
      description: 'Fixture',
      sourceTool: 'vision_fixture',
      previewIntent: 'text',
    })).rejects.toMatchObject({ code: 'path' })
  })
})
