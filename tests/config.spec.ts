import { describe, expect, it, vi } from 'vitest'
import {
  BUILT_IN_FREE_VISION_BASE_URL,
  BUILT_IN_FREE_VISION_CREDENTIAL,
  BUILT_IN_FREE_VISION_KEY,
  BUILT_IN_FREE_VISION_MODEL,
  DEFAULT_VISION_USER_AGENT,
  isBuiltInFreeVisionProvider,
  prepareWatchedSettingsGeneration,
  retainedStorageHistory,
  resolveConfig,
} from '../src/config.ts'

describe('resolveConfig', () => {
  it('applies install-and-use free vision defaults', () => {
    const config = resolveConfig({})
    expect(config.provider.baseUrl).toBe(BUILT_IN_FREE_VISION_BASE_URL)
    expect(config.provider.credential).toBe(BUILT_IN_FREE_VISION_CREDENTIAL)
    expect(BUILT_IN_FREE_VISION_KEY).toBe('https://agent-vision.anionex.me')
    expect(config.provider.model).toBe(BUILT_IN_FREE_VISION_MODEL)
    expect(config.provider.protocol).toBe('openai')
    expect(config.provider.anthropicThinking).toBe('omit')
    expect(config.provider.userAgent).toBe(DEFAULT_VISION_USER_AGENT)
    expect(config.provider.headers).toEqual({})
    expect(config.provider.sessionHeaders).toEqual([])
    expect(config.language).toBe('zh')
    expect(config.timeoutMs).toBe(30000)
    expect(config.maxImageBytes).toBe(4194304)
    expect(config.maxImagePixels).toBe(20000000)
    expect(isBuiltInFreeVisionProvider(config.provider)).toBe(true)
    expect(config.concurrency).toBe(4)
    expect(config.runtime.mode).toBe('managed')
    expect(config.runtime.python).toBeUndefined()
    expect(config.storageDir).toBeUndefined()
    expect(config.storageHistory).toEqual([])
    expect(config.allowedDirs).toEqual([])
    expect(config.imageInputVariants).toEqual({ enabled: true, providers: [], autoSwitch: true, hidden: true })
  })

  it('normalizes and sorts provider header names', () => {
    const config = resolveConfig({
      provider: {
        headers: { ' X-Tenant ': 'acme', 'x-deployment': 'edge' },
        sessionHeaders: [' X-OpenCode-Session ', 'x-request-route'],
      },
    })
    expect(config.provider.headers).toEqual({ 'x-deployment': 'edge', 'x-tenant': 'acme' })
    expect(config.provider.sessionHeaders).toEqual(['x-opencode-session', 'x-request-route'])
  })

  it('rejects duplicate and conflicting provider header names case-insensitively', () => {
    expect(() => resolveConfig({ provider: { headers: { 'X-Tenant': 'a', ' x-tenant ': 'b' } } }))
      .toThrow(/duplicate name "x-tenant"/u)
    expect(() => resolveConfig({ provider: { sessionHeaders: ['X-Route', ' x-route '] } }))
      .toThrow(/duplicate name "x-route"/u)
    expect(() => resolveConfig({ provider: { headers: { 'X-Route': 'static' }, sessionHeaders: ['x-route'] } }))
      .toThrow(/both name "x-route"/u)
  })

  it.each(['Authorization', 'x-api-key', 'Content-Type', 'User-Agent', 'anthropic-version', 'Host', 'Content-Length', 'Transfer-Encoding', 'Connection', 'Cookie'])('rejects transport-owned provider header %s', (name) => {
    expect(() => resolveConfig({ provider: { headers: { [name]: 'value' } } }))
      .toThrow(/client or HTTP transport owns it/u)
    expect(() => resolveConfig({ provider: { sessionHeaders: [name] } }))
      .toThrow(/client or HTTP transport owns it/u)
  })

  it('rejects empty or unsendable provider header names and values without echoing values', () => {
    const secret = 'sensitive\nvalue'
    expect(() => resolveConfig({ provider: { headers: { '  ': 'value' } } }))
      .toThrow(/empty name/u)
    expect(() => resolveConfig({ provider: { sessionHeaders: ['bad header name'] } }))
      .toThrow(/not a valid HTTP header/u)
    let thrown: unknown
    try {
      resolveConfig({ provider: { headers: { 'x-bad': secret } } })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(String(thrown)).not.toContain(secret)
    expect(String(thrown)).not.toContain('sensitive')
  })

  it('bounds provider header count and byte size', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`x-field-${index}`, 'x']))
    expect(() => resolveConfig({ provider: { headers: tooMany } }))
      .toThrow(/at most 32 entries/u)
    expect(() => resolveConfig({ provider: { headers: { [`x-${'a'.repeat(127)}`]: 'x' } } }))
      .toThrow(/128-byte name limit/u)
    expect(() => resolveConfig({ provider: { headers: { 'x-large': 'x'.repeat(4097) } } }))
      .toThrow(/4096-byte value limit/u)
    expect(() => resolveConfig({ provider: { headers: {
      'x-one': 'a'.repeat(4096),
      'x-two': 'b'.repeat(4096),
      'x-three': 'c'.repeat(4096),
      'x-four': 'd'.repeat(4096),
    } } })).toThrow(/16384-byte total limit/u)
  })

  it('normalizes image-input variant settings', () => {
    const config = resolveConfig({
      imageInputVariants: {
        enabled: false,
        providers: [' deepseek-official ', '  ', 'glm'],
      },
    })
    expect(config.imageInputVariants).toEqual({ enabled: false, providers: ['deepseek-official', 'glm'], autoSwitch: true, hidden: true })
    expect(resolveConfig({ imageInputVariants: {} }).imageInputVariants).toEqual({ enabled: true, providers: [], autoSwitch: true, hidden: true })
    expect(resolveConfig({ imageInputVariants: { hidden: true } }).imageInputVariants.hidden).toBe(true)
  })

  it('retains prior storage roots across resolved Settings generations', () => {
    expect(retainedStorageHistory(
      { storageDir: '/storage/c', storageHistory: ['/storage/a'] },
      { storageDir: '/storage/b', storageHistory: ['/storage/a'] },
    )).toEqual(['/storage/a', '/storage/b'])
    expect(retainedStorageHistory(
      { storageDir: '/storage/a' },
      { storageDir: '/storage/a', storageHistory: ['/storage/b'] },
    )).toEqual(['/storage/b'])
  })

  it('keeps read-only or failed history writeback from blocking live Settings activation', async () => {
    const previous = { storageDir: '/storage/a' }
    const next = { storageDir: '/storage/b' }
    const readOnlyPersist = vi.fn(async () => {})

    await expect(prepareWatchedSettingsGeneration(next, previous, false, readOnlyPersist))
      .resolves.toEqual({
        config: { storageDir: '/storage/b', storageHistory: ['/storage/a'] },
        requiresDurableStorageHistory: true,
      })
    expect(readOnlyPersist).not.toHaveBeenCalled()

    const failure = new Error('read-only provider')
    const failedPersist = vi.fn(async () => { throw failure })
    await expect(prepareWatchedSettingsGeneration(next, previous, true, failedPersist))
      .resolves.toEqual({
        config: { storageDir: '/storage/b', storageHistory: ['/storage/a'] },
        requiresDurableStorageHistory: true,
        persistenceError: failure,
      })
  })

  it('does not treat an omitted empty history as a writeback requirement', async () => {
    const persist = vi.fn(async () => {})

    await expect(prepareWatchedSettingsGeneration(
      { storageDir: '/storage/a', concurrency: 2 },
      { storageDir: '/storage/a', concurrency: 1 },
      false,
      persist,
    )).resolves.toEqual({ config: { storageDir: '/storage/a', concurrency: 2 } })
    expect(persist).not.toHaveBeenCalled()
  })

  it('waits for the persisted Settings generation after internal history writeback succeeds', async () => {
    const persist = vi.fn(async () => {})

    await expect(prepareWatchedSettingsGeneration(
      { storageDir: '/storage/b' },
      { storageDir: '/storage/a' },
      true,
      persist,
    )).resolves.toEqual({})
    expect(persist).toHaveBeenCalledWith(['/storage/a'])
  })

  it('normalizes the provider URL and credential', () => {
    const config = resolveConfig({
      provider: {
        baseUrl: 'https://example.com/v1/',
        credential: 'MY_VISION_KEY',
        model: 'model-x',
        protocol: 'anthropic',
        anthropicThinking: 'disabled',
        userAgent: 'custom-vision-client/2.0',
      },
      language: 'en',
      runtime: { mode: 'external', agentVisionToolkitPath: '/tmp/toolkit', python: 'python3.12' },
      storageDir: ' /tmp/dsh-vision-toolkit ',
      storageHistory: [' /previous/storage ', '/tmp/dsh-vision-toolkit', '/previous/storage', '  '],
      allowedDirs: ['~/Pictures'],
    })
    expect(config.provider.baseUrl).toBe('https://example.com/v1')
    expect(config.provider.credential).toBe('MY_VISION_KEY')
    expect(config.runtime.agentVisionToolkitPath).toBe('/tmp/toolkit')
    expect(config.storageDir).toBe('/tmp/dsh-vision-toolkit')
    expect(config.storageHistory).toEqual(['/previous/storage'])
    expect(config.provider.protocol).toBe('anthropic')
    expect(config.provider.anthropicThinking).toBe('disabled')
    expect(config.provider.userAgent).toBe('custom-vision-client/2.0')
    expect(config.allowedDirs).toEqual(['~/Pictures'])
    expect(resolveConfig({ storageDir: '   ' }).storageDir).toBeUndefined()
  })

  it('keeps the v0.1.10 Moondream default recognized as the built-in free provider', () => {
    const config = resolveConfig({
      provider: {
        baseUrl: BUILT_IN_FREE_VISION_BASE_URL,
        credential: BUILT_IN_FREE_VISION_CREDENTIAL,
        model: 'moondream-3.1',
        protocol: 'openai',
      },
    })
    expect(isBuiltInFreeVisionProvider(config.provider)).toBe(true)
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

  it('rejects an unsupported Anthropic thinking mode', () => {
    expect(() => resolveConfig({ provider: { anthropicThinking: 'manual' as 'omit' } }))
      .toThrowError(/provider\.anthropicThinking/)
  })

  it('rejects an unsupported provider protocol', () => {
    expect(() => resolveConfig({ provider: { protocol: 'responses' as 'openai' } }))
      .toThrowError(/provider\.protocol/)
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
