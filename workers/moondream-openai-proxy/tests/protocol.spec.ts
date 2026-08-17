import { describe, expect, it } from 'vitest'

import {
  CANONICAL_MODEL,
  ProtocolError,
  boxOrderForModel,
  buildGemmaInput,
  buildVisionInput,
  completionContent,
  completionFinishReason,
  normalizeGemmaOutput,
  parseChatCompletionRequest,
  tokenUsage,
} from '../src/protocol'

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messages: [{
      content: [
        { text: 'Describe this image.', type: 'text' },
        { image_url: { url: tinyPng }, type: 'image_url' },
      ],
      role: 'user',
    }],
    model: CANONICAL_MODEL,
    ...overrides,
  }
}

describe('parseChatCompletionRequest', () => {
  it('maps a standard OpenAI vision request to the Gemma vision task', () => {
    expect(parseChatCompletionRequest(request(), 1024)).toMatchObject({
      images: [tinyPng],
      question: 'User: Describe this image.',
      task: 'query',
    })
  })

  it('accepts a public HTTPS image and task extensions', () => {
    const parsed = parseChatCompletionRequest(request({
      caption_length: 'long',
      messages: [{
        content: [
          { text: 'person wearing red', type: 'text' },
          { image_url: { url: 'https://images.example.com/a.png' }, type: 'image_url' },
        ],
        role: 'user',
      }],
      task: 'detect',
    }), 1024)
    expect(parsed).toMatchObject({
      captionLength: 'long',
      target: 'person wearing red',
      task: 'detect',
    })
  })

  it('does not apply the detect target limit to a normal long query', () => {
    const text = 'x'.repeat(600)
    const parsed = parseChatCompletionRequest(request({
      messages: [{
        content: [
          { text, type: 'text' },
          { image_url: { url: tinyPng }, type: 'image_url' },
        ],
        role: 'user',
      }],
    }), 1024)
    expect(parsed.question).toContain(text)
    expect(parsed.target).toBe('person')
  })

  it.each([
    ['http://images.example.com/a.png', 'public HTTPS URL'],
    ['https://localhost/a.png', 'public HTTPS URL'],
    ['https://127.0.0.1/a.png', 'public HTTPS URL'],
  ])('rejects unsafe image URL %s', (url, message) => {
    expect(() => parseChatCompletionRequest(request({
      messages: [{
        content: [{ image_url: { url }, type: 'image_url' }],
        role: 'user',
      }],
    }), 1024)).toThrow(message)
  })

  it('accepts up to five images and preserves their order', () => {
    const parsed = parseChatCompletionRequest(request({
      messages: [{
        content: [
          { image_url: { url: tinyPng }, type: 'image_url' },
          { image_url: { url: 'https://images.example.com/second.png' }, type: 'image_url' },
        ],
        role: 'user',
      }],
    }), 1024)
    expect(parsed.images).toEqual([tinyPng, 'https://images.example.com/second.png'])
  })

  it('rejects requests with more than five images', () => {
    expect(() => parseChatCompletionRequest(request({
      messages: [{
        content: Array.from({ length: 6 }, () => ({ image_url: { url: tinyPng }, type: 'image_url' })),
        role: 'user',
      }],
    }), 1024)).toThrow('At most 5 user image_url values are supported')
  })

  it('rejects oversized decoded image data', () => {
    try {
      parseChatCompletionRequest(request(), 1)
      throw new Error('expected parse to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError)
      expect((error as ProtocolError).status).toBe(413)
    }
  })

  it('rejects malformed base64 and fractional max_tokens', () => {
    expect(() => parseChatCompletionRequest(request({
      messages: [{
        content: [{ image_url: { url: 'data:image/png;base64,abc' }, type: 'image_url' }],
        role: 'user',
      }],
    }), 1024)).toThrow('invalid base64')
    expect(() => parseChatCompletionRequest(request({ max_tokens: 1.5 }), 1024)).toThrow('integer')
  })

  it('supports max_completion_tokens and rejects conflicting token limits', () => {
    expect(parseChatCompletionRequest(request({ max_completion_tokens: 128 }), 1024).maxTokens).toBe(128)
    expect(parseChatCompletionRequest(request({ max_completion_tokens: 128, max_tokens: 128 }), 1024).maxTokens).toBe(128)
    expect(() => parseChatCompletionRequest(request({
      max_completion_tokens: 128,
      max_tokens: 64,
    }), 1024)).toThrow('must match')
  })

  it('rejects streaming and tool calls explicitly', () => {
    expect(() => parseChatCompletionRequest(request({ stream: true }), 1024)).toThrow('stream=true')
    expect(() => parseChatCompletionRequest(request({ tools: [{ type: 'function' }] }), 1024)).toThrow('tools')
  })
})

describe('response mapping', () => {
  it('unwraps the result envelopes returned by Workers AI', () => {
    expect(normalizeGemmaOutput({ result: { choices: [{ message: { content: 'A chart.' } }] } })).toEqual({
      choices: [{ message: { content: 'A chart.' } }],
    })
    expect(normalizeGemmaOutput({ result: { result: { response: 'A caption.' } } })).toEqual({ response: 'A caption.' })
  })

  it('maps textual and structured task results', () => {
    expect(completionContent({ choices: [{ message: { content: 'A chart.' } }] }, 'query')).toBe('A chart.')
    expect(completionContent({ response: 'A long caption.' }, 'caption')).toBe('A long caption.')
    expect(completionContent({ response: '```json\n{\"points\":[{\"x\":12,\"y\":25}]}\n```' }, 'point')).toBe(
      '{\"points\":[{\"x\":12,\"y\":25}]}',
    )
    expect(completionContent({ response: '{\"objects\":[{\"label\":\"button\",\"box_2d\":[10,20,30,40]}]}' }, 'detect')).toBe(
      '{\"objects\":[{\"label\":\"button\",\"box_2d\":[10,20,30,40]}]}',
    )
  })

  it('rejects malformed structured locations instead of returning a false success', () => {
    expect(() => completionContent({ response: '{\"objects\":[{\"label\":\"button\"}]}' }, 'detect')).toThrow(
      'structured tasks must return JSON',
    )
    expect(() => completionContent({ response: '{\"objects\":[{\"box_2d\":[0,0,1001,10]}]}' }, 'detect')).toThrow(
      'structured tasks must return JSON',
    )
    expect(() => completionContent({ response: '{\"points\":[{\"x\":-1,\"y\":10}]}' }, 'point')).toThrow(
      'structured tasks must return JSON',
    )
  })

  it('builds Cloudflare Gemma chat input with the validated image data URI', () => {
    const completion = parseChatCompletionRequest(request({ task: 'query', temperature: 0.2, top_p: 0.8 }), 1024)
    expect(buildGemmaInput(completion, [tinyPng], 256)).toEqual({
      messages: [{
        content: [
          { text: 'User: Describe this image.', type: 'text' },
          { image_url: { url: tinyPng }, type: 'image_url' },
        ],
        role: 'user',
      }],
      max_tokens: 256,
      stream: false,
      temperature: 0.2,
      top_p: 0.8,
    })
  })

  it('uses Qwen-native xyxy boxes and Gemini-native yxyx boxes for detect', () => {
    const completion = parseChatCompletionRequest(request({
      messages: [{
        content: [
          { text: 'Find every button', type: 'text' },
          { image_url: { url: tinyPng }, type: 'image_url' },
        ],
        role: 'user',
      }],
      task: 'detect',
    }), 1024)
    const qwenPrompt = buildVisionInput(completion, [tinyPng], 256, 'xyxy').messages[0].content[0]
    const geminiPrompt = buildVisionInput(completion, [tinyPng], 256, 'yxyx').messages[0].content[0]
    expect(qwenPrompt).toMatchObject({ text: expect.stringContaining('[x0,y0,x1,y1]') })
    expect(qwenPrompt).toMatchObject({ text: expect.stringContaining('x1>x0 and y1>y0') })
    expect(geminiPrompt).toMatchObject({ text: expect.stringContaining('[y0,x0,y1,x1]') })
    expect(geminiPrompt).toMatchObject({ text: expect.stringContaining('y1>y0 and x1>x0') })
  })

  it('maps model names to their native box order', () => {
    expect(boxOrderForModel('qwen/qwen3.6-27b')).toBe('xyxy')
    expect(boxOrderForModel('gemini-3.7-flash')).toBe('yxyx')
  })

  it('returns OpenAI-style token usage', () => {
    expect(tokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 4 } })).toEqual({
      completion_tokens: 4,
      prompt_tokens: 10,
      total_tokens: 14,
    })
  })

  it('preserves the first choice finish reason', () => {
    expect(completionFinishReason({ choices: [{ finish_reason: 'length' }] })).toBe('length')
    expect(completionFinishReason({ finish_reason: 'stop' })).toBe('stop')
  })
})
