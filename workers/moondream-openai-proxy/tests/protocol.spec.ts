import { describe, expect, it } from 'vitest'

import {
  CANONICAL_MODEL,
  ProtocolError,
  completionContent,
  normalizeMoondreamOutput,
  parseChatCompletionRequest,
  tokenUsage,
} from '../src/protocol'

const tinyPng = 'data:image/png;base64,iVBORw0KGgo='

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
  it('maps a standard OpenAI vision request to Moondream query input', () => {
    expect(parseChatCompletionRequest(request(), 1024)).toMatchObject({
      image: tinyPng,
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

  it('rejects multiple images instead of silently dropping one', () => {
    expect(() => parseChatCompletionRequest(request({
      messages: [{
        content: [
          { image_url: { url: tinyPng }, type: 'image_url' },
          { image_url: { url: tinyPng }, type: 'image_url' },
        ],
        role: 'user',
      }],
    }), 1024)).toThrow('Exactly one user image_url is required')
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

  it('rejects streaming and tool calls explicitly', () => {
    expect(() => parseChatCompletionRequest(request({ stream: true }), 1024)).toThrow('stream=true')
    expect(() => parseChatCompletionRequest(request({ tools: [{ type: 'function' }] }), 1024)).toThrow('tools')
  })
})

describe('response mapping', () => {
  it('unwraps the result envelopes returned by Workers AI', () => {
    expect(normalizeMoondreamOutput({ result: { answer: 'A chart.' } })).toEqual({ answer: 'A chart.' })
    expect(normalizeMoondreamOutput({ result: { result: { caption: 'A caption.' } } })).toEqual({
      caption: 'A caption.',
    })
  })

  it('maps textual and structured task results', () => {
    expect(completionContent({ answer: 'A chart.' }, 'query')).toBe('A chart.')
    expect(completionContent({ caption: 'A long caption.' }, 'caption')).toBe('A long caption.')
    expect(completionContent({ points: [{ x: 0.5, y: 0.25 }] }, 'point')).toBe(
      '{"points":[{"x":0.5,"y":0.25}]}',
    )
  })

  it('returns OpenAI-style token usage', () => {
    expect(tokenUsage({ metrics: { input_tokens: 10, output_tokens: 4 } })).toEqual({
      completion_tokens: 4,
      prompt_tokens: 10,
      total_tokens: 14,
    })
  })
})
