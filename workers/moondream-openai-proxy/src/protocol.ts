export const CANONICAL_MODEL = '@cf/moondream/moondream3.1-9B-A2B'

const MODEL_ALIASES = new Set([
  CANONICAL_MODEL,
  'moondream',
  'moondream-3.1',
  'moondream3.1-9B-A2B',
])

const SUPPORTED_IMAGE_DATA_URI = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/
const SUPPORTED_TASKS = new Set(['query', 'caption', 'point', 'detect'])
const SUPPORTED_CAPTION_LENGTHS = new Set(['short', 'normal', 'long'])
const MAX_QUESTION_CHARS = 16_000

export type MoondreamTask = 'query' | 'caption' | 'point' | 'detect'
export type CaptionLength = 'short' | 'normal' | 'long'

export interface ParsedCompletionRequest {
  captionLength: CaptionLength
  image: string
  maxTokens: number | undefined
  question: string
  target: string
  task: MoondreamTask
  temperature: number | undefined
  topP: number | undefined
}

export interface MoondreamOutput {
  answer?: unknown
  caption?: unknown
  finish_reason?: unknown
  metrics?: unknown
  objects?: unknown
  points?: unknown
}

export class ProtocolError extends Error {
  readonly code: string
  readonly param: string | null
  readonly status: number

  constructor(message: string, options?: { code?: string; param?: string | null; status?: number }) {
    super(message)
    this.name = 'ProtocolError'
    this.code = options?.code ?? 'invalid_request'
    this.param = options?.param ?? null
    this.status = options?.status ?? 400
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeMoondreamOutput(value: Record<string, unknown>): MoondreamOutput {
  let current: Record<string, unknown> = value
  for (let depth = 0; depth < 3; depth += 1) {
    if (
      'answer' in current
      || 'caption' in current
      || 'objects' in current
      || 'points' in current
      || 'metrics' in current
    ) {
      return current
    }
    if (!isRecord(current.result)) break
    current = current.result
  }
  throw new ProtocolError('The vision model returned an unsupported response shape', {
    code: 'upstream_invalid_response',
    status: 502,
  })
}

function requireRecord(value: unknown, param: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ProtocolError(`${param} must be an object`, { param })
  }
  return value
}

function readOptionalNumber(
  input: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = input[name]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ProtocolError(`${name} must be between ${minimum} and ${maximum}`, { param: name })
  }
  return value
}

function readOptionalInteger(
  input: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = readOptionalNumber(input, name, minimum, maximum)
  if (value !== undefined && !Number.isInteger(value)) {
    throw new ProtocolError(`${name} must be an integer`, { param: name })
  }
  return value
}

function extractText(content: unknown, param: string): string[] {
  if (typeof content === 'string') return content.trim() ? [content.trim()] : []
  if (!Array.isArray(content)) {
    throw new ProtocolError(`${param} must be a string or content-part array`, { param })
  }

  const text: string[] = []
  for (const [index, rawPart] of content.entries()) {
    const part = requireRecord(rawPart, `${param}[${index}]`)
    if (part.type === 'text') {
      if (typeof part.text !== 'string') {
        throw new ProtocolError(`${param}[${index}].text must be a string`, {
          param: `${param}[${index}].text`,
        })
      }
      if (part.text.trim()) text.push(part.text.trim())
    }
  }
  return text
}

function extractImage(content: unknown, param: string): string[] {
  if (!Array.isArray(content)) return []
  const images: string[] = []
  for (const [index, rawPart] of content.entries()) {
    const part = requireRecord(rawPart, `${param}[${index}]`)
    if (part.type !== 'image_url') continue
    const imageUrl = requireRecord(part.image_url, `${param}[${index}].image_url`)
    if (typeof imageUrl.url !== 'string' || imageUrl.url.length === 0) {
      throw new ProtocolError(`${param}[${index}].image_url.url must be a non-empty string`, {
        param: `${param}[${index}].image_url.url`,
      })
    }
    images.push(imageUrl.url)
  }
  return images
}

export function validatePublicHttpsImageUrl(image: string): string {
  let url: URL
  try {
    url = new URL(image)
  } catch {
    throw new ProtocolError('image_url must be a supported base64 data URI or public HTTPS URL', {
      param: 'messages',
    })
  }

  const hostname = url.hostname.toLowerCase()
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')
  const isLocalName = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || !hostname.includes('.')

  if (url.protocol !== 'https:' || url.username || url.password || isIpLiteral || isLocalName || image.length > 2048) {
    throw new ProtocolError('image_url must be a public HTTPS URL without credentials', {
      param: 'messages',
    })
  }
  return url.toString()
}

function validateImage(image: string, maxImageBytes: number): string {
  const dataUri = SUPPORTED_IMAGE_DATA_URI.exec(image)
  if (dataUri) {
    const encoded = dataUri[2] ?? ''
    if (encoded.length % 4 !== 0) {
      throw new ProtocolError('image_url contains invalid base64 image data', { param: 'messages' })
    }
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
    const decodedBytes = Math.floor((encoded.length * 3) / 4) - padding
    if (decodedBytes <= 0 || decodedBytes > maxImageBytes) {
      throw new ProtocolError(`Decoded image must be between 1 and ${maxImageBytes} bytes`, {
        code: 'image_too_large',
        param: 'messages',
        status: decodedBytes > maxImageBytes ? 413 : 400,
      })
    }
    return image
  }

  return validatePublicHttpsImageUrl(image)
}

export function parseChatCompletionRequest(value: unknown, maxImageBytes: number): ParsedCompletionRequest {
  const input = requireRecord(value, 'body')
  if (typeof input.model !== 'string' || !MODEL_ALIASES.has(input.model)) {
    throw new ProtocolError(`model must be ${CANONICAL_MODEL} or a supported alias`, {
      code: 'model_not_found',
      param: 'model',
      status: 404,
    })
  }
  if (input.stream === true) {
    throw new ProtocolError('stream=true is not supported by this proxy', {
      code: 'unsupported_parameter',
      param: 'stream',
    })
  }
  if (input.n !== undefined && input.n !== 1) {
    throw new ProtocolError('n must be 1', { code: 'unsupported_parameter', param: 'n' })
  }
  if (Array.isArray(input.tools) && input.tools.length > 0) {
    throw new ProtocolError('tools are not supported by this vision proxy', {
      code: 'unsupported_parameter',
      param: 'tools',
    })
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new ProtocolError('messages must be a non-empty array', { param: 'messages' })
  }

  const textSegments: string[] = []
  const images: string[] = []
  let lastUserText = ''
  for (const [index, rawMessage] of input.messages.entries()) {
    const message = requireRecord(rawMessage, `messages[${index}]`)
    const role = message.role
    if (role !== 'system' && role !== 'developer' && role !== 'user' && role !== 'assistant') {
      throw new ProtocolError(`messages[${index}].role is not supported`, {
        param: `messages[${index}].role`,
      })
    }
    const text = extractText(message.content, `messages[${index}].content`)
    if (text.length > 0) {
      const label = role === 'user' ? 'User' : role === 'assistant' ? 'Assistant' : 'Instructions'
      textSegments.push(`${label}: ${text.join('\n')}`)
      if (role === 'user') lastUserText = text.join('\n')
    }
    if (role === 'user') images.push(...extractImage(message.content, `messages[${index}].content`))
  }

  if (images.length !== 1) {
    throw new ProtocolError('Exactly one user image_url is required', { param: 'messages' })
  }
  const question = textSegments.join('\n\n') || "What's in this image?"
  if (question.length > MAX_QUESTION_CHARS) {
    throw new ProtocolError(`Combined message text exceeds ${MAX_QUESTION_CHARS} characters`, {
      param: 'messages',
      status: 413,
    })
  }

  const taskValue = input.task ?? 'query'
  if (typeof taskValue !== 'string' || !SUPPORTED_TASKS.has(taskValue)) {
    throw new ProtocolError('task must be query, caption, point, or detect', { param: 'task' })
  }
  const captionLengthValue = input.caption_length ?? 'normal'
  if (typeof captionLengthValue !== 'string' || !SUPPORTED_CAPTION_LENGTHS.has(captionLengthValue)) {
    throw new ProtocolError('caption_length must be short, normal, or long', {
      param: 'caption_length',
    })
  }
  let target = 'person'
  if (taskValue === 'point' || taskValue === 'detect') {
    const targetValue = (input.target ?? lastUserText) || 'person'
    if (typeof targetValue !== 'string' || targetValue.trim().length === 0 || targetValue.length > 500) {
      throw new ProtocolError('target must be a non-empty string up to 500 characters', { param: 'target' })
    }
    target = targetValue.trim()
  }

  return {
    captionLength: captionLengthValue as CaptionLength,
    image: validateImage(images[0] ?? '', maxImageBytes),
    maxTokens: readOptionalInteger(input, 'max_tokens', 1, 28_672),
    question,
    target,
    task: taskValue as MoondreamTask,
    temperature: readOptionalNumber(input, 'temperature', 0, 2),
    topP: readOptionalNumber(input, 'top_p', 0, 1),
  }
}

export function completionContent(output: MoondreamOutput, task: MoondreamTask): string {
  if (task === 'query' && typeof output.answer === 'string') return output.answer
  if (task === 'caption' && typeof output.caption === 'string') return output.caption
  if (task === 'point' && Array.isArray(output.points)) return JSON.stringify({ points: output.points })
  if (task === 'detect' && Array.isArray(output.objects)) return JSON.stringify({ objects: output.objects })
  throw new ProtocolError('The vision model returned no usable result', {
    code: 'upstream_invalid_response',
    status: 502,
  })
}

export function tokenUsage(output: MoondreamOutput): {
  completion_tokens: number
  prompt_tokens: number
  total_tokens: number
} {
  const metrics = isRecord(output.metrics) ? output.metrics : {}
  const promptTokens = typeof metrics.input_tokens === 'number' ? metrics.input_tokens : 0
  const completionTokens = typeof metrics.output_tokens === 'number' ? metrics.output_tokens : 0
  return {
    completion_tokens: completionTokens,
    prompt_tokens: promptTokens,
    total_tokens: promptTokens + completionTokens,
  }
}
