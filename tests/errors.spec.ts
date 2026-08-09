import { describe, expect, it } from 'vitest'
import { redactText, upstreamFailureMessage, VisionToolkitError } from '../src/errors.ts'

describe('VisionToolkitError', () => {
  it('carries a stable error code', () => {
    const error = new VisionToolkitError('capacity', 'too big')
    expect(error.name).toBe('VisionToolkitError')
    expect(error.code).toBe('capacity')
    expect(error.message).toBe('too big')
  })
})

describe('redactText', () => {
  it('replaces every secret occurrence', () => {
    expect(redactText('key=abc123 and abc123 again', ['abc123']))
      .toBe('key=<redacted> and <redacted> again')
  })

  it('ignores empty secrets', () => {
    expect(redactText('hello', ['', ''])).toBe('hello')
  })
})

describe('upstreamFailureMessage', () => {
  it('keeps only the stderr tail and redacts secrets', () => {
    const message = upstreamFailureMessage('glance', 'line1\nline2\nkey=secret-42\n', ['secret-42'])
    expect(message).toContain('glance:')
    expect(message).toContain('key=<redacted>')
    expect(message).not.toContain('secret-42')
    expect(message).not.toContain('line1')
  })

  it('falls back when stderr is empty', () => {
    expect(upstreamFailureMessage('crop', '', [])).toBe('crop: upstream command failed')
  })
})
