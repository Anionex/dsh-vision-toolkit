import { createServer, type Server } from 'node:http'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ArtifactAccessController,
  PRESENTATION_META_KEY,
  prepareArtifactAccessKey,
} from '../src/artifact-access.ts'
import type { ArtifactDescriptor } from '../src/artifacts.ts'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(
  filename: string,
  bytes: Buffer | string,
  facts: Pick<ArtifactDescriptor, 'mimeType' | 'kind' | 'previewIntent'>,
  layout: 'legacy' | 'shared' = 'legacy',
) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-vision-access-'))
  roots.push(root)
  const storageRoot = layout === 'legacy'
    ? join(root, 'workspace', '.dsh-vision-toolkit')
    : join(root, 'shared', 'a'.repeat(20))
  const artifacts = join(storageRoot, 'artifacts')
  await mkdir(artifacts, { recursive: true, mode: 0o700 })
  const path = join(artifacts, filename)
  await writeFile(path, bytes)
  const size = (await readFile(path)).length
  const descriptor: ArtifactDescriptor = {
    path,
    filename,
    mimeType: facts.mimeType,
    kind: facts.kind,
    description: `fixture ${filename}`,
    sourceTool: 'vision_fixture',
    previewIntent: facts.previewIntent,
    bytes: size,
  }
  return { root, path, descriptor, storageRoot }
}

async function listen(controller: ArtifactAccessController): Promise<string> {
  const server = createServer((req, res) => { void controller.handle(req, res) })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind a TCP port')
  return `http://127.0.0.1:${address.port}`
}

function grantOf(controller: ArtifactAccessController, descriptor: ArtifactDescriptor) {
  const detach = controller.attachRoute()
  const meta = controller.presentationMeta({ artifact: descriptor }) as Record<string, unknown>
  detach()
  const envelope = meta[PRESENTATION_META_KEY] as { artifacts: Array<{ previewUrl: string; downloadUrl: string }> }
  const grant = envelope.artifacts[0]
  if (grant === undefined) throw new Error('presentation grant missing')
  return grant
}

describe('ArtifactAccessController', () => {
  it('serves a signed image with safe headers and a download disposition', async () => {
    const { root, descriptor } = await fixture('preview.png', Buffer.from('not-a-real-png'), {
      mimeType: 'image/png', kind: 'image', previewIntent: 'image',
    })
    const key = await prepareArtifactAccessKey(join(root, 'state'))
    const controller = new ArtifactAccessController(key)
    const grant = grantOf(controller, descriptor)
    const base = await listen(controller)

    const preview = await fetch(`${base}${grant.previewUrl}`)
    expect(preview.status).toBe(200)
    expect(await preview.text()).toBe('not-a-real-png')
    expect(preview.headers.get('content-type')).toBe('image/png')
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff')
    expect(preview.headers.get('cache-control')).toContain('no-store')
    expect(preview.headers.get('content-disposition')).toContain('inline')

    const download = await fetch(`${base}${grant.downloadUrl}`)
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toContain('attachment')
  })

  it('keeps capabilities valid after a process-style key reload', async () => {
    const { root, descriptor } = await fixture('report.json', '{"ok":true}\n', {
      mimeType: 'application/json', kind: 'json', previewIntent: 'text',
    })
    const state = join(root, 'state')
    const first = new ArtifactAccessController(await prepareArtifactAccessKey(state))
    const grant = grantOf(first, descriptor)
    const restarted = new ArtifactAccessController(await prepareArtifactAccessKey(state))
    const base = await listen(restarted)

    const response = await fetch(`${base}${grant.previewUrl}`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"ok":true}\n')
  })

  it('serves artifacts from a private workspace directory below shared storage', async () => {
    const { root, descriptor } = await fixture('shared.png', 'shared-artifact', {
      mimeType: 'image/png', kind: 'image', previewIntent: 'image',
    }, 'shared')
    const controller = new ArtifactAccessController(await prepareArtifactAccessKey(join(root, 'state')))
    const grant = grantOf(controller, descriptor)
    const base = await listen(controller)

    const response = await fetch(`${base}${grant.previewUrl}`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('shared-artifact')
  })

  it('rejects a shared workspace artifact directory with permissive storage permissions', async () => {
    if (typeof process.geteuid !== 'function') return
    const { root, descriptor, storageRoot } = await fixture('shared.png', 'shared-artifact', {
      mimeType: 'image/png', kind: 'image', previewIntent: 'image',
    }, 'shared')
    await chmod(storageRoot, 0o755)
    const controller = new ArtifactAccessController(await prepareArtifactAccessKey(join(root, 'state')))
    const grant = grantOf(controller, descriptor)
    const base = await listen(controller)

    expect((await fetch(`${base}${grant.previewUrl}`)).status).toBe(404)
  })

  it('rejects forged tokens and a delivered file replaced by a symlink', async () => {
    const { root, path, descriptor } = await fixture('preview.png', 'inside', {
      mimeType: 'image/png', kind: 'image', previewIntent: 'image',
    })
    const controller = new ArtifactAccessController(await prepareArtifactAccessKey(join(root, 'state')))
    const grant = grantOf(controller, descriptor)
    const base = await listen(controller)

    expect((await fetch(`${base}${grant.previewUrl}x`)).status).toBe(404)
    const outside = join(root, 'outside.png')
    await writeFile(outside, 'inside')
    await unlink(path)
    await symlink(outside, path)
    expect((await fetch(`${base}${grant.previewUrl}`)).status).toBe(404)
  })

  it('serves SVG only with sandboxed, no-resource CSP', async () => {
    const { root, descriptor } = await fixture('shape.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', {
      mimeType: 'image/svg+xml', kind: 'svg', previewIntent: 'svg',
    })
    const controller = new ArtifactAccessController(await prepareArtifactAccessKey(join(root, 'state')))
    const grant = grantOf(controller, descriptor)
    const base = await listen(controller)
    const response = await fetch(`${base}${grant.previewUrl}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toContain("sandbox; default-src 'none'")
    expect(response.headers.get('content-security-policy')).not.toContain('script-src')
  })
})
