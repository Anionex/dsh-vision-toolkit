import { ProtocolError, validatePublicHttpsImageUrl } from './protocol'

const DATA_URI = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

type SupportedImageMime = 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp'

interface ImageHeader {
  height: number
  mime: SupportedImageMime
  width: number
}

function decodeBase64(value: string): Uint8Array {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new ProtocolError('image_url contains invalid base64 image data', { param: 'messages' })
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    const chunk = bytes.subarray(offset, offset + 32_768)
    let binary = ''
    for (const byte of chunk) binary += String.fromCharCode(byte)
    chunks.push(binary)
  }
  return btoa(chunks.join(''))
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function uint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0)) >>> 0
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset + 3] ?? 0) * 0x1000000)
    + ((bytes[offset + 2] ?? 0) << 16)
    + ((bytes[offset + 1] ?? 0) << 8)
    + (bytes[offset] ?? 0)) >>> 0
}

function parsePngHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null
  if (uint32BigEndian(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') return null
  return { height: uint32BigEndian(bytes, 20), mime: 'image/png', width: uint32BigEndian(bytes, 16) }
}

function parseGifHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 10) return null
  const signature = ascii(bytes, 0, 6)
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null
  return { height: uint16LittleEndian(bytes, 8), mime: 'image/gif', width: uint16LittleEndian(bytes, 6) }
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function parseJpegHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return null
    const marker = bytes[offset] ?? 0
    offset += 1
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) return null

    const segmentLength = uint16BigEndian(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) return null
      return {
        height: uint16BigEndian(bytes, offset + 3),
        mime: 'image/jpeg',
        width: uint16BigEndian(bytes, offset + 5),
      }
    }
    offset += segmentLength
  }
  return null
}

function parseWebpHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  const riffEnd = uint32LittleEndian(bytes, 4) + 8
  if (riffEnd > bytes.length || riffEnd < 20) return null

  let offset = 12
  while (offset + 8 <= riffEnd) {
    const chunkType = ascii(bytes, offset, 4)
    const chunkSize = uint32LittleEndian(bytes, offset + 4)
    const payload = offset + 8
    const chunkEnd = payload + chunkSize
    if (chunkEnd > riffEnd) return null

    if (chunkType === 'VP8X' && chunkSize >= 10) {
      return {
        height: uint24LittleEndian(bytes, payload + 7) + 1,
        mime: 'image/webp',
        width: uint24LittleEndian(bytes, payload + 4) + 1,
      }
    }
    if (chunkType === 'VP8L' && chunkSize >= 5 && bytes[payload] === 0x2f) {
      const b1 = bytes[payload + 1] ?? 0
      const b2 = bytes[payload + 2] ?? 0
      const b3 = bytes[payload + 3] ?? 0
      const b4 = bytes[payload + 4] ?? 0
      return {
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)),
        mime: 'image/webp',
        width: 1 + (((b2 & 0x3f) << 8) | b1),
      }
    }
    if (
      chunkType === 'VP8 '
      && chunkSize >= 10
      && bytes[payload + 3] === 0x9d
      && bytes[payload + 4] === 0x01
      && bytes[payload + 5] === 0x2a
    ) {
      return {
        height: uint16LittleEndian(bytes, payload + 8) & 0x3fff,
        mime: 'image/webp',
        width: uint16LittleEndian(bytes, payload + 6) & 0x3fff,
      }
    }
    offset = chunkEnd + (chunkSize % 2)
  }
  return null
}

function parseImageHeader(bytes: Uint8Array): ImageHeader | null {
  return parsePngHeader(bytes) ?? parseJpegHeader(bytes) ?? parseGifHeader(bytes) ?? parseWebpHeader(bytes)
}

export function detectImageMime(bytes: Uint8Array): SupportedImageMime | null {
  return parseImageHeader(bytes)?.mime ?? null
}

function validateBytes(bytes: Uint8Array, maxBytes: number, maxPixels: number): SupportedImageMime {
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new ProtocolError(`Decoded image must be between 1 and ${maxBytes} bytes`, {
      code: 'image_too_large',
      param: 'messages',
      status: bytes.length > maxBytes ? 413 : 400,
    })
  }
  const header = parseImageHeader(bytes)
  if (!header || header.width <= 0 || header.height <= 0) {
    throw new ProtocolError('image_url does not contain a complete supported image header', { param: 'messages' })
  }
  if (header.width * header.height > maxPixels) {
    throw new ProtocolError(`Image dimensions exceed ${maxPixels} pixels`, {
      code: 'image_too_large',
      param: 'messages',
      status: 413,
    })
  }
  return header.mime
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new ProtocolError('Remote image response has no body', { param: 'messages' })
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ProtocolError(`Remote image exceeds ${maxBytes} bytes`, {
      code: 'image_too_large',
      param: 'messages',
      status: 413,
    })
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel('remote image too large')
      throw new ProtocolError(`Remote image exceeds ${maxBytes} bytes`, {
        code: 'image_too_large',
        param: 'messages',
        status: 413,
      })
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function fetchRemoteImage(image: string, maxBytes: number, maxPixels: number): Promise<string> {
  let current = validatePublicHttpsImageUrl(image)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response: Response
    try {
      response = await fetch(current, {
        headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new ProtocolError('Unable to fetch the remote image', {
        code: 'image_fetch_failed',
        param: 'messages',
      })
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location || redirects === 3) {
        throw new ProtocolError('Remote image redirected too many times', {
          code: 'image_fetch_failed',
          param: 'messages',
        })
      }
      current = validatePublicHttpsImageUrl(new URL(location, current).toString())
      continue
    }
    if (!response.ok) {
      throw new ProtocolError(`Remote image request failed with HTTP ${response.status}`, {
        code: 'image_fetch_failed',
        param: 'messages',
      })
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
      throw new ProtocolError('Remote image response has an unsupported Content-Type', { param: 'messages' })
    }
    const bytes = await readLimitedBody(response, maxBytes)
    const mime = validateBytes(bytes, maxBytes, maxPixels)
    return `data:${mime};base64,${encodeBase64(bytes)}`
  }
  throw new ProtocolError('Unable to fetch the remote image', { code: 'image_fetch_failed', param: 'messages' })
}

export async function materializeImage(image: string, maxBytes: number, maxPixels: number): Promise<string> {
  const match = DATA_URI.exec(image)
  if (!match) return fetchRemoteImage(image, maxBytes, maxPixels)
  const bytes = decodeBase64(match[2] ?? '')
  const mime = validateBytes(bytes, maxBytes, maxPixels)
  return `data:${mime};base64,${encodeBase64(bytes)}`
}
