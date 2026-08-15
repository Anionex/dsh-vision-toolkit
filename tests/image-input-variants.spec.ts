import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentBlock, GenerateOptions, LlmModelInfo, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  abortableWait,
  contentHasImage,
  convertImagesToEvidence,
  EvidenceCache,
  ImageInputVariantAdapter,
  installImageInputVariants,
  sessionPasteTakeover,
  shouldWrapModel,
  variantProviderId,
  VARIANT_SUFFIX,
} from '../src/image-input-variants.ts'
import type { ResolvedVisionToolkitConfig } from '../src/config.ts'
import { resolveConfig } from '../src/config.ts'
import type { VisionToolkitRuntime } from '../src/runtime.ts'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dvt-variants-'))
  roots.push(root)
  return root
}

function attachment(id: string, mediaType = 'image/png') {
  return { attachmentId: id, mediaType, bytes: 3, width: 2, height: 2 }
}

function imageBlock(id: string): ContentBlock {
  return { type: 'image', attachment: attachment(id) }
}

function message(id: string, content: ContentBlock[]): Message {
  return { id: id as never, role: 'user', content, source: { kind: 'user' } }
}

function glanceResult(answer: string) {
  return { images: [], mode: 'describe' as const, answer, truncated: false }
}

function runtimeStub(glance: ReturnType<typeof vi.fn>) {
  return { glance } as unknown as VisionToolkitRuntime
}

describe('image-input variant predicates', () => {
  it('wraps only models the host positively declares text-only', () => {
    expect(shouldWrapModel({ inputModalities: ['text'] })).toBe(true)
    expect(shouldWrapModel({ inputModalities: ['text', 'image'] })).toBe(false)
    expect(shouldWrapModel({ inputModalities: undefined })).toBe(false)
    expect(shouldWrapModel({})).toBe(false)
  })

  it('mints a prefixed provider route and a shared display suffix', () => {
    expect(variantProviderId('deepseek-official')).toBe('vision-toolkit-deepseek-official')
    expect(`${'DeepSeek'}${VARIANT_SUFFIX}`).toBe('DeepSeek (Vision Toolkit)')
  })

  it('finds images nested inside tool-result content', () => {
    expect(contentHasImage([imageBlock('a')])).toBe(true)
    expect(contentHasImage([{ type: 'text', text: 'plain' }])).toBe(false)
    expect(contentHasImage([{
      type: 'tool-result',
      toolCallId: 'c1',
      content: [{ type: 'text', text: 'x' }, imageBlock('nested')],
    }])).toBe(true)
    expect(contentHasImage([{
      type: 'tool-result',
      toolCallId: 'c1',
      content: [{ type: 'text', text: 'x' }],
    }])).toBe(false)
  })
})

describe('EvidenceCache', () => {
  it('caches a successful description and joins concurrent readers on one computation', async () => {
    const cache = new EvidenceCache(4)
    let runs = 0
    const load = vi.fn(async () => {
      runs += 1
      await new Promise(resolve => setTimeout(resolve, 5))
      return { ok: true as const, block: { type: 'text' as const, text: 'described' } }
    })
    const [first, second] = await Promise.all([cache.read('a', load), cache.read('a', load)])
    expect(first).toEqual({ type: 'text', text: 'described' })
    expect(second).toEqual(first)
    expect(runs).toBe(1)
    const third = await cache.read('a', load)
    expect(third).toEqual(first)
    expect(runs).toBe(1)
  })

  it('evicts failed reads so a fixed configuration gets a fresh chance', async () => {
    const cache = new EvidenceCache(4)
    const load = vi.fn(async () => ({ ok: false as const, block: { type: 'text' as const, text: 'degraded' } }))
    const first = await cache.read('a', load)
    expect(first).toEqual({ type: 'text', text: 'degraded' })
    await cache.read('a', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used entry beyond the limit', async () => {
    const cache = new EvidenceCache(2)
    const load = vi.fn(async (key: string) => ({ ok: true as const, block: { type: 'text' as const, text: key } }))
    await cache.read('a', () => load('a'))
    await cache.read('b', () => load('b'))
    await cache.read('a', () => load('a'))
    await cache.read('c', () => load('c'))
    expect(load).toHaveBeenCalledTimes(3)
    expect(await cache.read('a', () => load('a'))).toEqual({ type: 'text', text: 'a' })
    expect(await cache.read('c', () => load('c'))).toEqual({ type: 'text', text: 'c' })
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('rejects a waiting reader when its caller aborts, without cancelling the read', async () => {
    const cache = new EvidenceCache(4)
    let settled = false
    const load = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      settled = true
      return { ok: true as const, block: { type: 'text' as const, text: 'slow' } }
    })
    const controller = new AbortController()
    const waiting = abortableWait(cache.read('a', load), controller.signal)
    controller.abort()
    await expect(waiting).rejects.toThrow('aborted')
    expect(settled).toBe(false)
    expect(await cache.read('a', load)).toEqual({ type: 'text', text: 'slow' })
    expect(settled).toBe(true)
  })
})

describe('convertImagesToEvidence', () => {
  it('rewrites top-level and nested image blocks and leaves the originals untouched', async () => {
    const glance = vi.fn(async () => glanceResult('a red circle'))
    const attachments = { readImage: vi.fn(async () => ({ ref: attachment('a'), data: Uint8Array.of(1, 2, 3) })) }
    const ctx = { get: (name: string) => name === 'attachments' ? attachments : undefined } as never
    const root = await tempRoot()
    const before = [
      message('m1', [{ type: 'text', text: 'caption' }, imageBlock('a')]),
      message('m2', [{
        type: 'tool-result',
        toolCallId: 'c1',
        content: [imageBlock('b')],
      }]),
    ]
    const after = await convertImagesToEvidence(ctx, () => runtimeStub(glance), new EvidenceCache(4), before, new AbortController().signal)

    expect(before[0]?.content[1]).toEqual(imageBlock('a'))
    expect(after[0]?.content).toHaveLength(2)
    expect(after[0]?.content[1]).toEqual({ type: 'text', text: '[Image described by the Vision Toolkit]\na red circle' })
    const nested = after[1]?.content[0]
    expect(nested).toMatchObject({ type: 'tool-result' })
    expect((nested as { content: ContentBlock[] }).content[0]).toMatchObject({ type: 'text' })
    expect(glance).toHaveBeenCalledTimes(2)
    // Every conversion ran inside its own temp directory, now removed.
    expect(await readdir(root)).toEqual([])
  })

  it('reuses one description for the same attachment across messages and passes', async () => {
    const glance = vi.fn(async () => glanceResult('same image'))
    const attachments = { readImage: vi.fn(async () => ({ ref: attachment('a'), data: Uint8Array.of(1) })) }
    const ctx = { get: (name: string) => name === 'attachments' ? attachments : undefined } as never
    const cache = new EvidenceCache(4)
    const messages = [message('m1', [imageBlock('a')])]
    await convertImagesToEvidence(ctx, () => runtimeStub(glance), cache, messages)
    await convertImagesToEvidence(ctx, () => runtimeStub(glance), cache, messages)
    expect(glance).toHaveBeenCalledTimes(1)
  })

  it('degrades to an explanatory block when the runtime or attachments are unavailable', async () => {
    const ctx = { get: () => undefined } as never
    const messages = [message('m1', [imageBlock('a')])]
    const converted = await convertImagesToEvidence(ctx, () => undefined, new EvidenceCache(4), messages)
    expect(converted[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('[The Vision Toolkit could not describe this image:'),
    })
  })

  it('degrades a failed read and keeps the request going', async () => {
    const glance = vi.fn(async () => { throw new Error('vision API down') })
    const attachments = { readImage: vi.fn(async () => ({ ref: attachment('a'), data: Uint8Array.of(1) })) }
    const ctx = { get: (name: string) => name === 'attachments' ? attachments : undefined } as never
    const messages = [message('m1', [imageBlock('a')])]
    const converted = await convertImagesToEvidence(ctx, () => runtimeStub(glance), new EvidenceCache(4), messages)
    expect(converted[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('vision API down'),
    })
  })

  it('returns the original message references when nothing carries an image', async () => {
    const ctx = { get: () => undefined } as never
    const messages = [message('m1', [{ type: 'text', text: 'plain' }])]
    const converted = await convertImagesToEvidence(ctx, () => undefined, new EvidenceCache(4), messages)
    expect(converted[0]).toBe(messages[0])
  })
})

describe('ImageInputVariantAdapter', () => {
  function llmStub(overrides: Record<string, unknown> = {}) {
    return {
      listModels: vi.fn(async () => []),
      resolveModelInfo: vi.fn(async (_provider: string, model: string) => ({
        provider: 'up',
        id: model,
        name: model,
        inputModalities: ['text'],
      })),
      stream: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'finish', reason: { kind: 'stop' } }
      }),
      ...overrides,
    }
  }

  const base = resolveConfig({ imageInputVariants: {} })

  it('advertises only text-only upstream models as image-input variants', async () => {
    const upstreamModels: LlmModelInfo[] = [
      { provider: 'up', id: 'plain', name: 'Plain', inputModalities: ['text'] },
      { provider: 'up', id: 'vision', name: 'Vision', inputModalities: ['text', 'image'] },
      { provider: 'up', id: 'unknown', name: 'Unknown' },
    ]
    const ctx = { llm: llmStub({ listModels: vi.fn(async () => upstreamModels) }) } as never
    const adapter = new ImageInputVariantAdapter(ctx, ctx.llm, 'up', 'Upstream', () => undefined, new EvidenceCache(4))
    const models = await adapter.listModels('vision-toolkit-up')
    expect(models).toEqual([
      {
        provider: 'vision-toolkit-up',
        id: 'plain',
        name: `Plain${VARIANT_SUFFIX}`,
        inputModalities: ['text', 'image'],
      },
    ])
  })

  it('resolves a wrapped model with image input and refuses a model outside the wrap scope', async () => {
    const ctx = { llm: llmStub() } as never
    const adapter = new ImageInputVariantAdapter(ctx, ctx.llm, 'up', 'Upstream', () => undefined, new EvidenceCache(4))
    const resolved = await adapter.resolveModel('vision-toolkit-up', 'plain')
    expect(resolved).toMatchObject({
      provider: 'vision-toolkit-up',
      id: 'plain',
      name: `plain${VARIANT_SUFFIX}`,
      inputModalities: ['text', 'image'],
    })
    const visionCtx = {
      llm: llmStub({ resolveModelInfo: vi.fn(async () => ({ provider: 'up', id: 'v', name: 'v', inputModalities: ['text', 'image'] })) }),
    } as never
    const adapterVision = new ImageInputVariantAdapter(visionCtx, visionCtx.llm, 'up', 'Upstream', () => undefined, new EvidenceCache(4))
    await expect(adapterVision.resolveModel('vision-toolkit-up', 'v')).rejects.toThrow('needs no image-input variant')
  })

  it('names the provider group with the variant suffix', () => {
    const ctx = { llm: llmStub() } as never
    const adapter = new ImageInputVariantAdapter(ctx, ctx.llm, 'up', 'Upstream', () => undefined, new EvidenceCache(4))
    expect(adapter.providerInfo('vision-toolkit-up')).toEqual({ id: 'vision-toolkit-up', name: `Upstream${VARIANT_SUFFIX}` })
  })

  it('rewrites image blocks on the wire and delegates to the upstream route', async () => {
    const glance = vi.fn(async () => glanceResult('wire description'))
    const attachments = { readImage: vi.fn(async () => ({ ref: attachment('a'), data: Uint8Array.of(1) })) }
    const delegated: GenerateOptions[] = []
    const upstreamStream = vi.fn(async function* (options: GenerateOptions): AsyncGenerator<StreamChunk> {
      delegated.push(options)
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const ctx = {
      get: (name: string) => name === 'attachments' ? attachments : undefined,
      llm: {
        listModels: vi.fn(async () => []),
        resolveModelInfo: vi.fn(async () => ({ provider: 'up', id: 'plain', name: 'Plain', inputModalities: ['text'] })),
        stream: upstreamStream,
      },
    } as never
    const adapter = new ImageInputVariantAdapter(ctx, ctx.llm, 'up', 'Upstream', () => runtimeStub(glance), new EvidenceCache(4))
    const options: GenerateOptions = {
      provider: 'vision-toolkit-up',
      model: 'plain',
      messages: [message('m1', [imageBlock('a')])],
    }
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(options)) chunks.push(chunk)
    expect(chunks).toHaveLength(1)
    expect(delegated).toHaveLength(1)
    expect(delegated[0]?.provider).toBe('up')
    expect(delegated[0]?.model).toBe('plain')
    expect(delegated[0]?.messages[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('wire description'),
    })
  })

  it('carries context, output caps, and reasoning metadata through resolveModel', async () => {
    const upstreamInfo = {
      provider: 'up', id: 'plain', name: 'Plain', inputModalities: ['text'],
      context: { contextWindow: 65536 },
      defaultMaxTokens: 4096,
      reasoning: {
        efforts: [{ id: 'high', name: 'High' }],
        defaultEffort: 'high',
      },
    }
    const ctx = {
      llm: llmStub({ resolveModelInfo: vi.fn(async () => upstreamInfo) }),
    } as never
    const adapter = new ImageInputVariantAdapter(ctx, ctx.llm, 'up', 'Upstream', () => undefined, new EvidenceCache(4))
    const resolved = await adapter.resolveModel('vision-toolkit-up', 'plain')
    expect(resolved).toMatchObject({
      provider: 'vision-toolkit-up',
      inputModalities: ['text', 'image'],
      context: { contextWindow: 65536 },
      defaultMaxTokens: 4096,
      reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
    })
  })

  it('streams a deep-frozen request without mutating it and delegates a fresh object', async () => {
    const glance = vi.fn(async () => glanceResult('frozen wire'))
    const attachments = { readImage: vi.fn(async () => ({ ref: attachment('a'), data: Uint8Array.of(1) })) }
    const delegated: GenerateOptions[] = []
    const upstreamStream = vi.fn(async function* (options: GenerateOptions): AsyncGenerator<StreamChunk> {
      delegated.push(options)
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const ctx = {
      get: (name: string) => name === 'attachments' ? attachments : undefined,
      llm: { listModels: vi.fn(async () => []), resolveModelInfo: vi.fn(), stream: upstreamStream },
    } as never
    const adapter = new ImageInputVariantAdapter(ctx, ctx.llm, 'up', 'Upstream', () => runtimeStub(glance), new EvidenceCache(4))
    const frozen: GenerateOptions = Object.freeze({
      provider: 'vision-toolkit-up',
      model: 'plain',
      messages: Object.freeze([message('m1', [imageBlock('a')])]),
    })
    for await (const _chunk of adapter.stream(frozen)) { /* drain */ }
    expect(delegated).toHaveLength(1)
    expect(delegated[0]).not.toBe(frozen)
    expect(delegated[0]?.provider).toBe('up')
  })

  it('lets a caller abort mid-conversion while the cached read completes for the retry', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const glance = vi.fn(async () => { await gate; return glanceResult('slow read') })
    const attachments = { readImage: vi.fn(async () => ({ ref: attachment('a'), data: Uint8Array.of(1) })) }
    const upstreamStream = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const ctx = {
      get: (name: string) => name === 'attachments' ? attachments : undefined,
      llm: { listModels: vi.fn(async () => []), resolveModelInfo: vi.fn(), stream: upstreamStream },
    } as never
    const cache = new EvidenceCache(4)
    const adapter = new ImageInputVariantAdapter(ctx, ctx.llm, 'up', 'Upstream', () => runtimeStub(glance), cache)
    const controller = new AbortController()
    const options: GenerateOptions = {
      provider: 'vision-toolkit-up',
      model: 'plain',
      messages: [message('m1', [imageBlock('a')])],
      signal: controller.signal,
    }
    const draining = (async () => {
      const chunks: StreamChunk[] = []
      try {
        for await (const chunk of adapter.stream(options)) chunks.push(chunk)
        return chunks
      } catch (error) {
        return error
      }
    })()
    // Wait until the conversion reached the (blocked) glance call, then abort.
    await vi.waitFor(() => { expect(glance).toHaveBeenCalledTimes(1) })
    controller.abort()
    const outcome = await draining
    expect(outcome).toBeInstanceOf(Error)
    // The underlying read is not cancelled: it completes and lands in the cache.
    release()
    const cached = await cache.read('a', async () => { throw new Error('must not recompute') })
    expect(cached).toEqual({ type: 'text', text: '[Image described by the Vision Toolkit]\nslow read' })
  })

  it('clears the description cache when the runtime instance changes', async () => {
    const first = runtimeStub(vi.fn(async () => glanceResult('first provider')))
    const second = runtimeStub(vi.fn(async () => glanceResult('second provider')))
    const attachments = { readImage: vi.fn(async () => ({ ref: attachment('a'), data: Uint8Array.of(1) })) }
    const delegated: GenerateOptions[] = []
    const upstreamStream = vi.fn(async function* (options: GenerateOptions): AsyncGenerator<StreamChunk> {
      delegated.push(options)
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const ctx = {
      get: (name: string) => name === 'attachments' ? attachments : undefined,
      llm: { listModels: vi.fn(async () => []), resolveModelInfo: vi.fn(), stream: upstreamStream },
    } as never
    let current: ReturnType<typeof runtimeStub> = first
    const cache = new EvidenceCache(4)
    const adapter = new ImageInputVariantAdapter(ctx, ctx.llm, 'up', 'Upstream', () => current, cache)
    const options: GenerateOptions = {
      provider: 'vision-toolkit-up',
      model: 'plain',
      messages: [message('m1', [imageBlock('a')])],
    }
    for await (const _chunk of adapter.stream(options)) { /* drain */ }
    expect(first.glance).toHaveBeenCalledTimes(1)
    for await (const _chunk of adapter.stream(options)) { /* drain */ }
    expect(first.glance).toHaveBeenCalledTimes(1)
    // A reconfigured runtime is a new instance: the stale description is gone.
    current = second
    for await (const _chunk of adapter.stream(options)) { /* drain */ }
    expect(second.glance).toHaveBeenCalledTimes(1)
    expect(delegated).toHaveLength(3)
  })
})

describe('sessionPasteTakeover', () => {
  it('answers true only for a positively text-only model route', async () => {
    const ctx = {
      sessions: {
        get: (sessionId: string) => sessionId === 's1'
          ? { requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'plain' } }) }
          : undefined,
      },
      llm: {
        resolveModelInfo: vi.fn(async () => ({ provider: 'deepseek-official', id: 'plain', name: 'Plain', inputModalities: ['text'] })),
      },
      get: (name: string) => name === 'llm' ? ctx.llm : undefined,
    } as never
    expect(await sessionPasteTakeover(ctx, 's1')).toBe(true)
  })

  it('answers false for an image-capable model', async () => {
    const ctx = {
      sessions: {
        get: () => ({ requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'vision' } }) }),
      },
      llm: {
        resolveModelInfo: vi.fn(async () => ({ provider: 'deepseek-official', id: 'vision', name: 'Vision', inputModalities: ['text', 'image'] })),
      },
      get: (name: string) => name === 'llm' ? ctx.llm : undefined,
    } as never
    expect(await sessionPasteTakeover(ctx, 's1')).toBe(false)
  })

  it('answers false for an unknown session, an unresolved route, or a resolution failure', async () => {
    const unknown = { sessions: { get: () => undefined }, llm: { resolveModelInfo: vi.fn() } } as never
    expect(await sessionPasteTakeover(unknown, 's1')).toBe(false)

    const noHeader = { sessions: { get: () => ({ requestHeader: () => undefined }) }, llm: { resolveModelInfo: vi.fn() } } as never
    expect(await sessionPasteTakeover(noHeader, 's1')).toBe(false)

    const failing = {
      sessions: { get: () => ({ requestHeader: () => ({ config: { provider: 'up', model: 'm' } }) }) },
      llm: { resolveModelInfo: vi.fn(async () => { throw new Error('no adapter') }) },
      get: (name: string) => name === 'llm' ? failing.llm : undefined,
    } as never
    expect(await sessionPasteTakeover(failing, 's1')).toBe(false)
  })

  it('resolves the verdict from the model-selector label before the session header', async () => {
    const models = [
      { provider: 'deepseek-official', id: 'plain', name: 'DeepSeek V4 Flash', inputModalities: ['text'] },
      { provider: 'vision-toolkit-deepseek-official', id: 'plain', name: 'DeepSeek V4 Flash (Vision Toolkit)', inputModalities: ['text', 'image'] },
    ]
    const ctx = {
      sessions: { get: () => undefined },
      llm: {
        listProviders: vi.fn(() => [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'vision-toolkit-deepseek-official', name: 'DeepSeek (Vision Toolkit)' }]),
        listModels: vi.fn(async () => models),
        resolveModelInfo: vi.fn(),
      },
      get: (name: string) => name === 'llm' ? ctx.llm : undefined,
    } as never
    // The variant label names an image-capable entry: native, never takeover.
    expect(await sessionPasteTakeover(ctx, 's1', 'Current model: DeepSeek V4 Flash (Vision Toolkit)')).toBe(false)
    // The plain label names only the text-only entry: takeover.
    expect(await sessionPasteTakeover(ctx, 's1', 'Current model: DeepSeek V4 Flash')).toBe(true)
    expect(ctx.llm.resolveModelInfo).not.toHaveBeenCalled()
  })

  it('falls back to the session header when the label matches nothing', async () => {
    const ctx = {
      sessions: {
        get: () => ({ requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'plain' } }) }),
      },
      llm: {
        listProviders: vi.fn(() => [{ id: 'deepseek-official', name: 'DeepSeek' }]),
        listModels: vi.fn(async () => [{ provider: 'deepseek-official', id: 'plain', name: 'Plain', inputModalities: ['text'] }]),
        resolveModelInfo: vi.fn(async () => ({ provider: 'deepseek-official', id: 'plain', name: 'Plain', inputModalities: ['text'] })),
      },
      get: (name: string) => name === 'llm' ? ctx.llm : undefined,
    } as never
    expect(await sessionPasteTakeover(ctx, 's1', 'Unrelated label prose')).toBe(true)
    expect(ctx.llm.resolveModelInfo).toHaveBeenCalledTimes(1)
  })

  it('vetoes the takeover when the label names an unconfirmed model', async () => {
    const ctx = {
      sessions: { get: () => undefined },
      llm: {
        listProviders: vi.fn(() => [{ id: 'up', name: 'Up' }]),
        listModels: vi.fn(async () => [{ provider: 'up', id: 'mystery', name: 'Mystery' }]),
        resolveModelInfo: vi.fn(),
      },
      get: (name: string) => name === 'llm' ? ctx.llm : undefined,
    } as never
    expect(await sessionPasteTakeover(ctx, 's1', 'Current: Mystery')).toBe(false)
  })
})

describe('installImageInputVariants', () => {
  function harness(overrides: Record<string, unknown> = {}) {
    const registrations = new Map<string, () => void>()
    const listeners: Array<() => void> = []
    const ctx = {
      llm: {
        listProviders: vi.fn(() => []),
        listModels: vi.fn(async () => []),
        registerAdapter: vi.fn((providers: string[]) => {
          const dispose = vi.fn(() => { for (const provider of providers) registrations.delete(provider) })
          for (const provider of providers) registrations.set(provider, dispose)
          return dispose
        }),
      },
      logger: { warn: vi.fn() },
      on: vi.fn((event: string, listener: () => void) => { listeners.push(listener) }),
      get: (name: string) => name === 'llm' ? ctx.llm : undefined,
      ...overrides,
    }
    return { ctx: ctx as never, registrations, listeners, llm: ctx.llm }
  }

  const config = (overrides: Partial<ResolvedVisionToolkitConfig['imageInputVariants']> = {}): ResolvedVisionToolkitConfig =>
    resolveConfig({ imageInputVariants: overrides })

  it('registers a variant route for every route with a text-only model', async () => {
    const { ctx, registrations, llm } = harness({
      llm: {
        listProviders: vi.fn(() => [{ id: 'deepseek-official', name: 'DeepSeek' }]),
        listModels: vi.fn(async () => [
          { provider: 'deepseek-official', id: 'plain', name: 'Plain', inputModalities: ['text'] },
          { provider: 'deepseek-official', id: 'vision', name: 'Vision', inputModalities: ['text', 'image'] },
        ]),
        registerAdapter: vi.fn((providers: string[]) => {
          const dispose = vi.fn(() => { for (const provider of providers) registrations.delete(provider) })
          for (const provider of providers) registrations.set(provider, dispose)
          return dispose
        }),
      },
    })
    const installer = installImageInputVariants(ctx, () => config(), () => undefined)
    await vi.waitFor(() => { expect(registrations.has('vision-toolkit-deepseek-official')).toBe(true) })
    expect(llm.listModels).toHaveBeenCalledWith('deepseek-official')
    installer.dispose()
    expect(registrations.size).toBe(0)
  })

  it('skips routes without eligible models and restricted routes', async () => {
    const { ctx, registrations } = harness()
    const installer = installImageInputVariants(ctx, () => config({ providers: ['other'] }), () => undefined)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(registrations.size).toBe(0)
    installer.dispose()
  })

  it('registers nothing while disabled and reconciles when enabled', async () => {
    const { ctx, registrations } = harness({
      llm: {
        listProviders: vi.fn(() => [{ id: 'deepseek-official', name: 'DeepSeek' }]),
        listModels: vi.fn(async () => [
          { provider: 'deepseek-official', id: 'plain', name: 'Plain', inputModalities: ['text'] },
        ]),
        registerAdapter: vi.fn((providers: string[]) => {
          const dispose = vi.fn(() => { for (const provider of providers) registrations.delete(provider) })
          for (const provider of providers) registrations.set(provider, dispose)
          return dispose
        }),
      },
    })
    let enabled = false
    const installer = installImageInputVariants(ctx, () => config({ enabled }), () => undefined)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(registrations.size).toBe(0)
    enabled = true
    installer.reconcile()
    await vi.waitFor(() => { expect(registrations.has('vision-toolkit-deepseek-official')).toBe(true) })
    installer.dispose()
    expect(registrations.size).toBe(0)
  })

  it('releases wrappers whose upstream route vanished and re-sweeps on topology changes', async () => {
    let providers: Array<{ id: string; name: string }> = [{ id: 'deepseek-official', name: 'DeepSeek' }]
    const { ctx, registrations, listeners } = harness({
      llm: {
        listProviders: vi.fn(() => providers),
        listModels: vi.fn(async () => [
          { provider: 'deepseek-official', id: 'plain', name: 'Plain', inputModalities: ['text'] },
        ]),
        registerAdapter: vi.fn((ids: string[]) => {
          const dispose = vi.fn(() => { for (const id of ids) registrations.delete(id) })
          for (const id of ids) registrations.set(id, dispose)
          return dispose
        }),
      },
    })
    const installer = installImageInputVariants(ctx, () => config(), () => undefined)
    await vi.waitFor(() => { expect(registrations.has('vision-toolkit-deepseek-official')).toBe(true) })
    providers = []
    expect(listeners).toHaveLength(1)
    listeners[0]?.()
    await vi.waitFor(() => { expect(registrations.size).toBe(0) })
    installer.dispose()
  })

  it('releases wrappers when the route restriction narrows', async () => {
    const { ctx, registrations } = harness({
      llm: {
        listProviders: vi.fn(() => [
          { id: 'deepseek-official', name: 'DeepSeek' },
          { id: 'glm', name: 'GLM' },
        ]),
        listModels: vi.fn(async (provider: string) => [
          { provider, id: 'plain', name: 'Plain', inputModalities: ['text'] },
        ]),
        registerAdapter: vi.fn((ids: string[]) => {
          const dispose = vi.fn(() => { for (const id of ids) registrations.delete(id) })
          for (const id of ids) registrations.set(id, dispose)
          return dispose
        }),
      },
    })
    let restrict: string[] = []
    const installer = installImageInputVariants(ctx, () => config({ providers: restrict }), () => undefined)
    await vi.waitFor(() => {
      expect(registrations.has('vision-toolkit-deepseek-official')).toBe(true)
      expect(registrations.has('vision-toolkit-glm')).toBe(true)
    })
    restrict = ['glm']
    installer.reconcile()
    await vi.waitFor(() => {
      expect(registrations.has('vision-toolkit-deepseek-official')).toBe(false)
      expect(registrations.has('vision-toolkit-glm')).toBe(true)
    })
    installer.dispose()
  })

  it('releases wrappers whose route lost every eligible model', async () => {
    let models: Array<{ provider: string; id: string; name: string; inputModalities: string[] }> = [
      { provider: 'deepseek-official', id: 'plain', name: 'Plain', inputModalities: ['text'] },
    ]
    const { ctx, registrations, listeners } = harness({
      llm: {
        listProviders: vi.fn(() => [{ id: 'deepseek-official', name: 'DeepSeek' }]),
        listModels: vi.fn(async () => models),
        registerAdapter: vi.fn((ids: string[]) => {
          const dispose = vi.fn(() => { for (const id of ids) registrations.delete(id) })
          for (const id of ids) registrations.set(id, dispose)
          return dispose
        }),
      },
    })
    const installer = installImageInputVariants(ctx, () => config(), () => undefined)
    await vi.waitFor(() => { expect(registrations.has('vision-toolkit-deepseek-official')).toBe(true) })
    models = [{ provider: 'deepseek-official', id: 'vision', name: 'Vision', inputModalities: ['text', 'image'] }]
    listeners[0]?.()
    await vi.waitFor(() => { expect(registrations.size).toBe(0) })
    installer.dispose()
  })
})
