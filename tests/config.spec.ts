import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { VisionToolkitError } from '../src/errors.ts'

describe('resolveConfig', () => {
  it('applies documented defaults', () => {
    const config = resolveConfig({})
    expect(config.provider.baseUrl).toBe('https://api.inferera.com/v1')
    expect(config.provider.credential).toBe('VISION_API_KEY')
    expect(config.provider.model).toBe('gemini-3.6-flash')
    expect(config.language).toBe('zh')
    expect(config.timeoutMs).toBe(60000)
    expect(config.maxImageBytes).toBe(10485760)
    expect(config.concurrency).toBe(4)
    expect(config.runtime.mode).toBe('external')
    expect(config.runtime.python).toBe('python3')
    expect(config.allowedDirs).toEqual([])
  })

  it('normalizes the provider URL and credential', () => {
    const config = resolveConfig({
      provider: { baseUrl: 'https://example.com/v1/', credential: 'MY_VISION_KEY', model: 'model-x' },
      language: 'en',
      runtime: { agentVisionToolkitPath: '/tmp/toolkit', python: 'python3.12' },
      allowedDirs: ['~/Pictures'],
    })
    expect(config.provider.baseUrl).toBe('https://example.com/v1')
    expect(config.provider.credential).toBe('MY_VISION_KEY')
    expect(config.runtime.agentVisionToolkitPath).toBe('/tmp/toolkit')
    expect(config.allowedDirs).toEqual(['~/Pictures'])
  })

  it('rejects a non-http baseUrl', () => {
    expect(() => resolveConfig({ provider: { baseUrl: 'ftp://x' } }))
      .toThrowError(/provider\.baseUrl/)
  })

  it('rejects an invalid credential reference', () => {
    expect(() => resolveConfig({ provider: { credential: 'not a ref!' } }))
      .toThrowError(/credential/)
  })

  it('rejects an empty model', () => {
    expect(() => resolveConfig({ provider: { model: '  ' } }))
      .toThrowError(/provider\.model/)
  })

  it('rejects unsupported language and limits', () => {
    expect(() => resolveConfig({ language: 'fr' as 'zh' })).toThrowError(/language/)
    expect(() => resolveConfig({ timeoutMs: 500 })).toThrowError(/timeoutMs/)
    expect(() => resolveConfig({ maxImageBytes: 1 })).toThrowError(/maxImageBytes/)
    expect(() => resolveConfig({ concurrency: 0 })).toThrowError(/concurrency/)
  })

  it('rejects managed runtime in P0 with a clear next step', () => {
    const error = (() => {
      try {
        resolveConfig({ runtime: { mode: 'managed' as 'external' } })
        return undefined
      } catch (caught) {
        return caught as VisionToolkitError
      }
    })()
    expect(error).toBeInstanceOf(VisionToolkitError)
    expect(error?.code).toBe('config')
    expect(error?.message).toContain('P1')
  })

  it('rejects empty toolkit path and python', () => {
    expect(() => resolveConfig({ runtime: { agentVisionToolkitPath: '  ' } })).toThrowError(/agentVisionToolkitPath/)
    expect(() => resolveConfig({ runtime: { python: '  ' } })).toThrowError(/runtime\.python/)
  })
})
