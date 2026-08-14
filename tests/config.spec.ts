import { describe, expect, it } from 'vitest'
import { DEFAULT_VISION_USER_AGENT, resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('applies documented defaults', () => {
    const config = resolveConfig({})
    expect(config.provider.baseUrl).toBe('https://api.inferera.com/v1')
    expect(config.provider.credential).toBe('VISION_API_KEY')
    expect(config.provider.model).toBe('gemini-3.6-flash')
    expect(config.provider.protocol).toBe('openai')
    expect(config.provider.userAgent).toBe(DEFAULT_VISION_USER_AGENT)
    expect(config.language).toBe('zh')
    expect(config.timeoutMs).toBe(60000)
    expect(config.maxImageBytes).toBe(10485760)
    expect(config.maxImagePixels).toBe(40000000)
    expect(config.concurrency).toBe(4)
    expect(config.runtime.mode).toBe('managed')
    expect(config.runtime.python).toBeUndefined()
    expect(config.allowedDirs).toEqual([])
  })

  it('normalizes the provider URL and credential', () => {
    const config = resolveConfig({
      provider: {
        baseUrl: 'https://example.com/v1/',
        credential: 'MY_VISION_KEY',
        model: 'model-x',
        protocol: 'anthropic',
        userAgent: 'custom-vision-client/2.0',
      },
      language: 'en',
      runtime: { mode: 'external', agentVisionToolkitPath: '/tmp/toolkit', python: 'python3.12' },
      allowedDirs: ['~/Pictures'],
    })
    expect(config.provider.baseUrl).toBe('https://example.com/v1')
    expect(config.provider.credential).toBe('MY_VISION_KEY')
    expect(config.runtime.agentVisionToolkitPath).toBe('/tmp/toolkit')
    expect(config.provider.protocol).toBe('anthropic')
    expect(config.provider.userAgent).toBe('custom-vision-client/2.0')
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

  it('rejects an empty User-Agent', () => {
    expect(() => resolveConfig({ provider: { userAgent: '  ' } }))
      .toThrowError(/provider\.userAgent/)
  })

  it('rejects unsupported language and limits', () => {
    expect(() => resolveConfig({ language: 'fr' as 'zh' })).toThrowError(/language/)
    expect(() => resolveConfig({ timeoutMs: 500 })).toThrowError(/timeoutMs/)
    expect(() => resolveConfig({ maxImageBytes: 1 })).toThrowError(/maxImageBytes/)
    expect(() => resolveConfig({ maxImagePixels: 0 })).toThrowError(/maxImagePixels/)
    expect(() => resolveConfig({ concurrency: 0 })).toThrowError(/concurrency/)
  })

  it('accepts managed runtime without a local checkout path', () => {
    expect(resolveConfig({ runtime: { mode: 'managed' } }).runtime).toEqual({ mode: 'managed' })
  })

  it('rejects contradictory or empty runtime settings', () => {
    expect(() => resolveConfig({ runtime: { mode: 'external', agentVisionToolkitPath: '  ' } })).toThrowError(/agentVisionToolkitPath/)
    expect(() => resolveConfig({ runtime: { mode: 'external' } })).toThrowError(/agentVisionToolkitPath/)
    expect(() => resolveConfig({ runtime: { mode: 'managed', agentVisionToolkitPath: '/tmp/toolkit' } })).toThrowError(/only valid/)
    expect(() => resolveConfig({ runtime: { python: '  ' } })).toThrowError(/runtime\.python/)
  })
})
