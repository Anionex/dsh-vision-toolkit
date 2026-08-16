import { ProtocolError, validatePublicHttpsImageUrl } from './protocol'

const DATA_URI = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

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

export function detectImageMime(bytes: Uint8Array): 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6))
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

function validateBytes(bytes: Uint8Array, maxBytes: number): 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp' {
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new ProtocolError(`Decoded image must be between 1 and ${maxBytes} bytes`, {
      code: 'image_too_large',
      param: 'messages',
      status: bytes.length > maxBytes ? 413 : 400,
    })
  }
  const mime = detectImageMime(bytes)
  if (!mime) throw new ProtocolError('image_url does not contain a supported image format', { param: 'messages' })
  return mime
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

async function fetchRemoteImage(image: string, maxBytes: number): Promise<string> {
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
    const mime = validateBytes(bytes, maxBytes)
    return `data:${mime};base64,${encodeBase64(bytes)}`
  }
  throw new ProtocolError('Unable to fetch the remote image', { code: 'image_fetch_failed', param: 'messages' })
}

export async function materializeImage(image: string, maxBytes: number): Promise<string> {
  const match = DATA_URI.exec(image)
  if (!match) return fetchRemoteImage(image, maxBytes)
  const bytes = decodeBase64(match[2] ?? '')
  const mime = validateBytes(bytes, maxBytes)
  return `data:${mime};base64,${encodeBase64(bytes)}`
}
