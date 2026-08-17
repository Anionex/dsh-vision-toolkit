export const DEFAULT_MODEL = 'gemini-3.7-flash'
export const QWEN_MODEL = 'qwen/qwen3.6-27b'
export const CANONICAL_MODEL = DEFAULT_MODEL

export type BoxOrder = 'xyxy' | 'yxyx'

const MODEL_ALIASES = new Set([
  CANONICAL_MODEL,
  'gemini-3.7-flash',
  QWEN_MODEL,
  'qwen3.6-27b',
  // Keep previous built-in names accepted so existing installations switch
  // to the new backend without requiring a settings migration.
  '@cf/google/gemma-4-26b-a4b-it',
  'gemma-4',
  'gemma-4-26b-a4b-it',
  'gemma-4-26b',
  '@cf/moondream/moondream3.1-9B-A2B',
  'moondream',
  'moondream-3.1',
  'moondream3.1-9B-A2B',
])

const SUPPORTED_IMAGE_DATA_URI = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/
const SUPPORTED_TASKS = new Set(['query', 'caption', 'point', 'detect'])
const SUPPORTED_CAPTION_LENGTHS = new Set(['short', 'normal', 'long'])
const MAX_QUESTION_CHARS = 16_000
export const MAX_IMAGES_PER_REQUEST = 5

export type VisionTask = 'query' | 'caption' | 'point' | 'detect'
export type MoondreamTask = VisionTask
export type CaptionLength = 'short' | 'normal' | 'long'

export interface ParsedCompletionRequest {
  captionLength: CaptionLength
  images: string[]
  maxTokens: number | undefined
  model: string
  question: string
  target: string
  task: VisionTask
  temperature: number | undefined
  topP: number | undefined
}

export interface VisionOutput {
  choices?: unknown
  finish_reason?: unknown
  metrics?: unknown
  output_text?: unknown
  response?: unknown
  result?: unknown
  usage?: unknown
}

export type GemmaOutput = VisionOutput
export type MoondreamOutput = VisionOutput

export interface VisionInput {
  messages: [{
    content: Array<
      | { text: string; type: 'text' }
      | { image_url: { url: string }; type: 'image_url' }
    >
    role: 'user'
  }]
  max_tokens: number
  stream: false
  temperature?: number
  top_p?: number
}

export type GemmaInput = VisionInput

export function boxOrderForModel(model: string): BoxOrder {
  return model.toLowerCase().includes('qwen') ? 'xyxy' : 'yxyx'
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

export function normalizeVisionOutput(value: Record<string, unknown>): VisionOutput {
  let current: Record<string, unknown> = value
  for (let depth = 0; depth < 3; depth += 1) {
    if ('choices' in current || 'response' in current || 'output_text' in current) {
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

export const normalizeGemmaOutput = normalizeVisionOutput
export const normalizeMoondreamOutput = normalizeVisionOutput

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

  if (images.length === 0) {
    throw new ProtocolError('At least one user image_url is required', { param: 'messages' })
  }
  if (images.length > MAX_IMAGES_PER_REQUEST) {
    throw new ProtocolError(`At most ${MAX_IMAGES_PER_REQUEST} user image_url values are supported`, {
      param: 'messages',
    })
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
  const maxTokens = readOptionalInteger(input, 'max_tokens', 1, 28_672)
  const maxCompletionTokens = readOptionalInteger(input, 'max_completion_tokens', 1, 28_672)
  if (maxTokens !== undefined && maxCompletionTokens !== undefined && maxTokens !== maxCompletionTokens) {
    throw new ProtocolError('max_tokens and max_completion_tokens must match when both are provided', {
      param: 'max_completion_tokens',
    })
  }

  return {
    captionLength: captionLengthValue as CaptionLength,
    images: images.map(image => validateImage(image, maxImageBytes)),
    maxTokens: maxCompletionTokens ?? maxTokens,
    model: input.model,
    question,
    target,
    task: taskValue as VisionTask,
    temperature: readOptionalNumber(input, 'temperature', 0, 2),
    topP: readOptionalNumber(input, 'top_p', 0, 1),
  }
}

function assistantText(output: GemmaOutput): string | undefined {
  const choices = Array.isArray(output.choices) ? output.choices : []
  const firstChoice = isRecord(choices[0]) ? choices[0] : undefined
  const message = firstChoice !== undefined && isRecord(firstChoice.message) ? firstChoice.message : undefined
  const content = message?.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (isRecord(content) && typeof content.text === 'string' && content.text.trim()) return content.text.trim()
  if (Array.isArray(content)) {
    const text = content
      .map(part => typeof part === 'string'
        ? part
        : isRecord(part) && typeof part.text === 'string' ? part.text : '')
      .map(part => part.trim())
      .filter(Boolean)
      .join('\n')
    if (text) return text
  }
  if (firstChoice !== undefined && typeof firstChoice.text === 'string' && firstChoice.text.trim()) {
    return firstChoice.text.trim()
  }
  if (typeof output.response === 'string' && output.response.trim()) return output.response.trim()
  if (isRecord(output.response) && typeof output.response.text === 'string' && output.response.text.trim()) {
    return output.response.text.trim()
  }
  const outputText = output.output_text
  return typeof outputText === 'string' && outputText.trim() ? outputText.trim() : undefined
}

function parseStructuredText(text: string, field: 'objects' | 'points', boxOrder: BoxOrder = 'yxyx'): unknown[] | undefined {
  const candidates = [text.trim()]
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1))
  const arrayStart = text.indexOf('[')
  const arrayEnd = text.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1))

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      const items = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed[field]) ? parsed[field] : undefined
      if (items !== undefined && validateStructuredItems(items, field, boxOrder)) return items
    } catch {
      // Gemma sometimes wraps JSON in a short sentence or a markdown fence.
    }
  }
  return undefined
}

function isGridCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000
}

function validateStructuredItems(items: unknown[], field: 'objects' | 'points', boxOrder: BoxOrder = 'yxyx'): boolean {
  if (field === 'points') {
    return items.every(item => isRecord(item) && isGridCoordinate(item.x) && isGridCoordinate(item.y))
  }
  return items.every((item) => {
    if (!isRecord(item) || !Array.isArray(item.box_2d) || item.box_2d.length !== 4) return false
    if (item.label !== undefined && (typeof item.label !== 'string' || item.label.trim().length === 0)) return false
    const [first, second, third, fourth] = item.box_2d
    const x0 = boxOrder === 'xyxy' ? first : second
    const y0 = boxOrder === 'xyxy' ? second : first
    const x1 = boxOrder === 'xyxy' ? third : fourth
    const y1 = boxOrder === 'xyxy' ? fourth : third
    return isGridCoordinate(y0)
      && isGridCoordinate(x0)
      && isGridCoordinate(y1)
      && isGridCoordinate(x1)
      && y1 > y0
      && x1 > x0
  })
}

export function buildVisionInput(
  completion: ParsedCompletionRequest,
  images: string[],
  maxTokens: number,
  boxOrder: BoxOrder = 'yxyx',
): VisionInput {
  let instruction = completion.question
  if (completion.task === 'caption') {
    instruction = `Describe this image ${completion.captionLength === 'long' ? 'in detail' : completion.captionLength === 'short' ? 'briefly' : 'clearly'}.`
  } else if (completion.task === 'point') {
    instruction = `Locate the center of every visible target matching "${completion.target}". Return ONLY valid JSON in the form {"points":[{"x":500,"y":500}]} using a 0-1000 coordinate grid. If it is not present, return {"points":[]}.`
  } else if (completion.task === 'detect') {
    const boxFormat = boxOrder === 'xyxy' ? '[x0,y0,x1,y1]' : '[y0,x0,y1,x1]'
    const bounds = boxOrder === 'xyxy' ? 'x1>x0 and y1>y0' : 'y1>y0 and x1>x0'
    instruction = `Find every visible "${completion.target}". Return ONLY valid JSON in the form {"objects":[{"label":"${completion.target}","box_2d":[100,200,300,400]}]}. Each box_2d must be ${boxFormat} on a 0-1000 coordinate grid with ${bounds}. If none are present, return {"objects":[]}.`
  }

  return {
    messages: [{
        content: [
          { text: instruction, type: 'text' },
          ...images.map(image => ({ image_url: { url: image }, type: 'image_url' as const })),
        ],
      role: 'user',
    }],
    max_tokens: maxTokens,
    stream: false,
    ...(completion.temperature === undefined ? {} : { temperature: completion.temperature }),
    ...(completion.topP === undefined ? {} : { top_p: completion.topP }),
  }
}

export const buildGemmaInput = buildVisionInput

export function completionContent(output: VisionOutput, task: VisionTask, boxOrder: BoxOrder = 'yxyx'): string {
  const text = assistantText(output)
  if (text !== undefined && (task === 'query' || task === 'caption')) return text
  if (text !== undefined && task === 'point') {
    const points = parseStructuredText(text, 'points')
    if (points !== undefined) return JSON.stringify({ points })
  }
  if (text !== undefined && task === 'detect') {
    const objects = parseStructuredText(text, 'objects', boxOrder)
    if (objects !== undefined) return JSON.stringify({ objects })
  }
  throw new ProtocolError('The vision model returned no usable result; structured tasks must return JSON', {
    code: 'upstream_invalid_response',
    status: 502,
  })
}

export function completionFinishReason(output: VisionOutput): string {
  const choices = Array.isArray(output.choices) ? output.choices : []
  const firstChoice = isRecord(choices[0]) ? choices[0] : undefined
  if (firstChoice !== undefined && typeof firstChoice.finish_reason === 'string') {
    return firstChoice.finish_reason
  }
  return typeof output.finish_reason === 'string' ? output.finish_reason : 'stop'
}

export function tokenUsage(output: VisionOutput): {
  completion_tokens: number
  prompt_tokens: number
  total_tokens: number
} {
  const usage = isRecord(output.usage) ? output.usage : {}
  const metrics = isRecord(output.metrics) ? output.metrics : {}
  const promptTokens = typeof usage.prompt_tokens === 'number'
    ? usage.prompt_tokens
    : typeof metrics.input_tokens === 'number' ? metrics.input_tokens : 0
  const completionTokens = typeof usage.completion_tokens === 'number'
    ? usage.completion_tokens
    : typeof metrics.output_tokens === 'number' ? metrics.output_tokens : 0
  return {
    completion_tokens: completionTokens,
    prompt_tokens: promptTokens,
    total_tokens: promptTokens + completionTokens,
  }
}
