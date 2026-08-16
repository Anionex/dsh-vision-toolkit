import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectImageMime, materializeImage } from '../src/image'

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const tinyPng = Uint8Array.from(Buffer.from(tinyPngBase64, 'base64'))

function imageData(bytes: Uint8Array, mime = 'image/png'): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('image materialization', () => {
  it('validates and canonicalizes base64 image data', async () => {
    expect(detectImageMime(tinyPng)).toBe('image/png')
    await expect(materializeImage(imageData(tinyPng), 1024, 20_000_000)).resolves.toBe(
      imageData(tinyPng),
    )
  })

  it('rejects non-image bytes hidden in a data URI', async () => {
    await expect(materializeImage('data:image/png;base64,PGh0bWw+', 1024, 20_000_000)).rejects.toThrow(
      'supported image header',
    )
  })

  it('rejects truncated and zero-sized image headers', async () => {
    const zeroWidthPng = tinyPng.slice()
    zeroWidthPng.fill(0, 16, 20)
    await expect(materializeImage('data:image/png;base64,iVBORw0KGgo=', 1024, 20_000_000)).rejects.toThrow(
      'complete supported image header',
    )
    await expect(materializeImage(imageData(zeroWidthPng), 1024, 20_000_000)).rejects.toThrow(
      'complete supported image header',
    )
  })

  it('rejects images whose decoded dimensions exceed the pixel limit', async () => {
    const oversizedPng = tinyPng.slice()
    oversizedPng.set([0, 0, 0x13, 0x88], 16)
    oversizedPng.set([0, 0, 0x13, 0x88], 20)
    await expect(materializeImage(imageData(oversizedPng), 1024, 20_000_000)).rejects.toThrow(
      'exceed 20000000 pixels',
    )
  })

  it('reads dimensions from GIF, JPEG, and WebP headers', () => {
    const gif = Uint8Array.from(Buffer.from('R0lGODlhAQABAA==', 'base64'))
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ])
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ])
    expect(detectImageMime(gif)).toBe('image/gif')
    expect(detectImageMime(jpeg)).toBe('image/jpeg')
    expect(detectImageMime(webp)).toBe('image/webp')
  })

  it('downloads and validates public HTTPS images before inference', async () => {
    const fetchMock = vi.fn(async () => new Response(tinyPng, {
      headers: { 'content-type': 'image/png' },
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(materializeImage('https://images.example.com/a.png', 1024, 20_000_000)).resolves.toBe(
      imageData(tinyPng),
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects oversized remote images before buffering them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(tinyPng, {
      headers: { 'content-length': '2048', 'content-type': 'image/png' },
      status: 200,
    })))
    await expect(materializeImage('https://images.example.com/a.png', 1024, 20_000_000)).rejects.toThrow(
      'exceeds 1024 bytes',
    )
  })
})
