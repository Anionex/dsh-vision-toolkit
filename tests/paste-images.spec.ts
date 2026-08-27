import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensurePathInside,
  MAX_PASTE_IMAGE_BYTES,
  PASTE_IMAGES_ROUTE,
  PastedImageBackend,
  safePastedImageName,
} from '../src/paste-images.ts'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dvt-paste-'))
  roots.push(root)
  return root
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')
}

async function setup(cwd: string, maxUploadBytes = MAX_PASTE_IMAGE_BYTES, storageDir?: string) {
  const ctx = {
    sessions: { get: (sessionId: string) => sessionId === 'session-1' ? { header: { cwd } } : undefined },
    logger: { warn: vi.fn() },
  }
  const backend = new PastedImageBackend(ctx as never, {
    maxUploadBytes: () => maxUploadBytes,
    storageDirectory: () => storageDir,
  })
  const server = createServer((req, res) => { void backend.handle(req, res) })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind')
  const base = `http://127.0.0.1:${address.port}`
  const upload = (name: string, type: string, bytes: Uint8Array, size = bytes.length) => {
    const query = new URLSearchParams({ sessionId: 'session-1', name, size: String(size) })
    return fetch(`${base}${PASTE_IMAGES_ROUTE}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': type, Origin: base },
      body: bytes,
    })
  }
  return { base, upload }
}

describe('pasted image Web backend', () => {
  it('copies every image from a multi-image paste into the live Session workspace', async () => {
    const cwd = await workspace()
    const { upload } = await setup(cwd)
    const responses = await Promise.all([
      upload('first.png', 'image/png', Uint8Array.of(1, 2, 3)),
      upload('second.webp', 'image/webp', Uint8Array.of(4, 5)),
    ])
    const values = await Promise.all(responses.map(async response => {
      expect(response.status).toBe(201)
      return (await response.json() as { value: { absolutePath: string } }).value
    }))

    expect(values).toHaveLength(2)
    expect(values.every(value => inside(cwd, value.absolutePath))).toBe(true)
    await expect(readFile(values[0]!.absolutePath)).resolves.toEqual(Buffer.from([1, 2, 3]))
    await expect(readFile(values[1]!.absolutePath)).resolves.toEqual(Buffer.from([4, 5]))
  })

  it('stores pasted images below the configured shared root without touching the workspace', async () => {
    const cwd = await workspace()
    const shared = await workspace()
    const { upload } = await setup(cwd, MAX_PASTE_IMAGE_BYTES, shared)
    const response = await upload('shared.png', 'image/png', Uint8Array.of(3, 2, 1))
    const value = (await response.json() as { value: { absolutePath: string } }).value

    expect(response.status).toBe(201)
    expect(inside(shared, value.absolutePath)).toBe(true)
    expect(inside(cwd, value.absolutePath)).toBe(false)
    await expect(readFile(value.absolutePath)).resolves.toEqual(Buffer.from([3, 2, 1]))
    await expect(readdir(cwd)).resolves.toEqual([])
  })

  it('sanitizes clipboard names and keeps generated paths below the plugin temp root', async () => {
    const cwd = await workspace()
    const { upload } = await setup(cwd)
    const response = await upload('../../../../outside.png', 'image/png', Uint8Array.of(9))
    const value = (await response.json() as { value: { absolutePath: string; filename: string } }).value

    expect(response.status).toBe(201)
    expect(inside(cwd, value.absolutePath)).toBe(true)
    expect(value.filename).toBe('outside.png')
    expect(basename(value.absolutePath)).toMatch(/^[0-9a-f-]+-outside\.png$/u)
    expect(() => ensurePathInside(cwd, join(cwd, '..', 'escape.png'))).toThrow(/escapes/u)
    expect(safePastedImageName('..\\..\\bad:<name>.png', 'image/png')).toBe('bad__name_.png')
    expect(safePastedImageName('CON.png', 'image/png')).toBe('_CON.png')
    expect(safePastedImageName('trailing... ', 'image/png')).toBe('trailing')
  })

  it('rejects a symlinked plugin temp root that resolves outside the workspace', async () => {
    const cwd = await workspace()
    const outside = await workspace()
    await symlink(outside, join(cwd, '.dsh-vision-toolkit'))
    const { upload } = await setup(cwd)
    const response = await upload('safe.png', 'image/png', Uint8Array.of(1))
    const body = await response.json() as { error: { message: string } }

    expect(response.status).toBe(400)
    expect(body.error.message).toMatch(/must be a real directory/u)
    await expect(readdir(outside)).resolves.toEqual([])
  })

  it('rejects non-images, missing Sessions, oversize bodies, and incomplete bodies', async () => {
    const cwd = await workspace()
    const { base, upload } = await setup(cwd, 2)
    expect((await upload('notes.txt', 'text/plain', Uint8Array.of(1))).status).toBe(400)
    expect((await upload('large.png', 'image/png', Uint8Array.of(1, 2, 3))).status).toBe(413)
    expect((await upload('short.png', 'image/png', Uint8Array.of(1), 2)).status).toBe(400)
    const missing = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=missing&name=x.png&size=1`, {
      method: 'POST', headers: { 'Content-Type': 'image/png', Origin: base }, body: Uint8Array.of(1),
    })
    expect(missing.status).toBe(400)
  })

  it('accepts images above the configured runtime byte limit for later auto-compression', async () => {
    const cwd = await workspace()
    const { upload } = await setup(cwd)
    const body = new Uint8Array(4 * 1024 * 1024 + 1).fill(7)
    const response = await upload('large.png', 'image/png', body)

    expect(response.status).toBe(201)
    const value = (await response.json() as { value: { absolutePath: string; bytes: number } }).value
    expect(value.bytes).toBe(body.length)
    expect(inside(cwd, value.absolutePath)).toBe(true)
  })
})
