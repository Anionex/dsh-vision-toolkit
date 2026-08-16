import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectImageMime, materializeImage } from '../src/image'

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('image materialization', () => {
  it('validates and canonicalizes base64 image data', async () => {
    expect(detectImageMime(pngSignature)).toBe('image/png')
    await expect(materializeImage('data:image/png;base64,iVBORw0KGgo=', 1024)).resolves.toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    )
  })

  it('rejects non-image bytes hidden in a data URI', async () => {
    await expect(materializeImage('data:image/png;base64,PGh0bWw+', 1024)).rejects.toThrow(
      'supported image format',
    )
  })

  it('downloads and validates public HTTPS images before inference', async () => {
    const fetchMock = vi.fn(async () => new Response(pngSignature, {
      headers: { 'content-type': 'image/png' },
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(materializeImage('https://images.example.com/a.png', 1024)).resolves.toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects oversized remote images before buffering them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(pngSignature, {
      headers: { 'content-length': '2048', 'content-type': 'image/png' },
      status: 200,
    })))
    await expect(materializeImage('https://images.example.com/a.png', 1024)).rejects.toThrow(
      'exceeds 1024 bytes',
    )
  })
})
