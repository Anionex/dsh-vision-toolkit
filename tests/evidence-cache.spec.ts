import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { resolveConfig } from '../src/config.ts'
import {
  createEvidenceCacheKey,
  EvidenceCache,
  evidenceRuntimeFingerprint,
  SessionEvidenceStore,
} from '../src/evidence-cache.ts'
import { convertImagesToEvidence } from '../src/image-input-variants.ts'
import type { VisionToolkitRuntime } from '../src/runtime.ts'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dvt-evidence-'))
  roots.push(root)
  return root
}

function attachment(id: string) {
  return { attachmentId: id, mediaType: 'image/png', bytes: 3, width: 2, height: 2 }
}

function imageMessage(text = 'describe this image', attachmentId = 'attachment-a'): Message {
  return {
    id: 'message-1' as never,
    role: 'user',
    source: { kind: 'user' },
    content: [
      { type: 'text', text },
      { type: 'image', attachment: attachment(attachmentId) },
    ],
  }
}

function runtimeStub(glance: ReturnType<typeof vi.fn>): VisionToolkitRuntime {
  return { glance } as unknown as VisionToolkitRuntime
}

function glanceResult(answer: string) {
  return { images: [], mode: 'describe' as const, answer, truncated: false }
}

interface StorageHarnessOptions {
  records?: Map<string, unknown>
  workspace: string
  createdAt?: number
  openError?: Error
}

function storageHarness(options: StorageHarnessOptions) {
  const records = options.records ?? new Map<string, unknown>()
  const sessionId = 'session-a'
  const session = {
    id: sessionId,
    header: {
      version: 0,
      id: sessionId,
      createdAt: options.createdAt ?? 1,
      cwd: options.workspace,
    },
  }
  const table = {
    get: vi.fn((key: string) => records.get(key)),
    entries: vi.fn(() => new Map(records).entries()),
    keys: vi.fn(() => new Map(records).keys()),
    get size() { return records.size },
    put: vi.fn(async (key: string, value: unknown) => { records.set(key, value) }),
    delete: vi.fn(async (key: string) => records.delete(key)),
    update: vi.fn(async (key: string, update: (current: unknown) => unknown) => {
      if (!records.has(key)) throw new Error('missing-key')
      const next = update(records.get(key))
      records.set(key, next)
      return next
    }),
  }
  const close = vi.fn(async () => {})
  const storageDomain = {
    open: vi.fn(async () => {
      if (options.openError !== undefined) throw options.openError
      return { table: vi.fn(() => table), close }
    }),
  }
  const attachments = {
    readImage: vi.fn(async () => ({ ref: attachment('attachment-a'), data: Uint8Array.of(1, 2, 3) })),
  }
  const logger = { warn: vi.fn() }
  const sessions = {
    get: vi.fn((id: string) => id === sessionId ? session : undefined),
    flush: vi.fn(async () => true),
  }
  const ctx = {
    attachments,
    logger,
    sessions,
    get: (name: string) => {
      if (name === 'attachments') return attachments
      if (name === 'storageDomain') return storageDomain
      return undefined
    },
    inject: vi.fn((_deps: unknown, callback: (storageCtx: unknown) => unknown) => {
      let cleanup: (() => void | Promise<void>) | undefined
      const applied = Promise.resolve()
        .then(() => callback({ ...ctx, storageDomain }))
        .then((result) => { if (typeof result === 'function') cleanup = result as () => void | Promise<void> })
      const fiber = {
        then: (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
          applied.then(() => onFulfilled({}), onRejected),
        dispose: vi.fn(async () => {
          await applied.catch(() => {})
          await cleanup?.()
        }),
      }
      return fiber
    }),
  }
  return { attachments, close, ctx: ctx as never, logger, records, sessionId, sessions, storageDomain, table }
}

describe('persistent image evidence cache', () => {
  it('replays byte-identical evidence after a new cache/store instance without another vision call', async () => {
    const workspace = await tempRoot()
    const records = new Map<string, unknown>()
    const firstHarness = storageHarness({ records, workspace })
    const glance = vi.fn(async () => glanceResult('stable description'))
    const runtimeHash = 'a'.repeat(64)
    const firstStore = new SessionEvidenceStore(firstHarness.ctx)
    const first = await convertImagesToEvidence(
      firstHarness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, firstStore),
      [imageMessage()],
      undefined,
      firstHarness.sessionId,
      runtimeHash,
    )

    expect(glance).toHaveBeenCalledTimes(1)
    expect(records.size).toBe(1)
    expect([...records.values()][0]).not.toContain('describe this image')
    firstStore.dispose()

    const secondHarness = storageHarness({ records, workspace })
    const secondStore = new SessionEvidenceStore(secondHarness.ctx)
    const second = await convertImagesToEvidence(
      secondHarness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, secondStore),
      [imageMessage()],
      undefined,
      secondHarness.sessionId,
      runtimeHash,
    )

    expect(glance).toHaveBeenCalledTimes(1)
    expect(secondHarness.attachments.readImage).not.toHaveBeenCalled()
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    secondStore.dispose()
  })

  it('does not reuse evidence when a Session id is recycled for a new lifecycle', async () => {
    const workspace = await tempRoot()
    const records = new Map<string, unknown>()
    const glance = vi.fn(async () => glanceResult(`description-${glance.mock.calls.length}`))
    const firstHarness = storageHarness({ records, workspace, createdAt: 1 })
    const firstStore = new SessionEvidenceStore(firstHarness.ctx)
    await convertImagesToEvidence(
      firstHarness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, firstStore),
      [imageMessage()],
      undefined,
      firstHarness.sessionId,
      'a'.repeat(64),
    )
    firstStore.dispose()

    const recycledHarness = storageHarness({ records, workspace, createdAt: 2 })
    const recycledStore = new SessionEvidenceStore(recycledHarness.ctx)
    await convertImagesToEvidence(
      recycledHarness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, recycledStore),
      [imageMessage()],
      undefined,
      recycledHarness.sessionId,
      'a'.repeat(64),
    )

    expect(glance).toHaveBeenCalledTimes(2)
    expect(records.size).toBe(2)
    recycledStore.dispose()
  })

  it('recomputes when the focus prompt or runtime fingerprint changes', async () => {
    const workspace = await tempRoot()
    const records = new Map<string, unknown>()
    const harness = storageHarness({ records, workspace })
    const glance = vi.fn(async () => glanceResult(`description-${glance.mock.calls.length}`))
    const store = new SessionEvidenceStore(harness.ctx)

    await convertImagesToEvidence(
      harness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, store),
      [imageMessage('read the chart')],
      undefined,
      harness.sessionId,
      'a'.repeat(64),
    )
    await convertImagesToEvidence(
      harness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, store),
      [imageMessage('read the legend')],
      undefined,
      harness.sessionId,
      'a'.repeat(64),
    )
    await convertImagesToEvidence(
      harness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, store),
      [imageMessage('read the chart')],
      undefined,
      harness.sessionId,
      'b'.repeat(64),
    )

    expect(glance).toHaveBeenCalledTimes(3)
    expect(records.size).toBe(3)
    store.dispose()
  })

  it('replays a degraded result after restart until the runtime fingerprint changes', async () => {
    const workspace = await tempRoot()
    const records = new Map<string, unknown>()
    const firstHarness = storageHarness({ records, workspace })
    const failedGlance = vi.fn(async () => { throw new Error('vision offline') })
    const firstStore = new SessionEvidenceStore(firstHarness.ctx)
    const first = await convertImagesToEvidence(
      firstHarness.ctx,
      () => runtimeStub(failedGlance),
      new EvidenceCache(4, firstStore),
      [imageMessage()],
      undefined,
      firstHarness.sessionId,
      'a'.repeat(64),
    )
    expect(JSON.stringify(first)).toContain('[vision unavailable: vision offline]')
    expect(records.size).toBe(1)
    firstStore.dispose()

    const secondHarness = storageHarness({ records, workspace })
    const recoveredGlance = vi.fn(async () => glanceResult('recovered'))
    const secondStore = new SessionEvidenceStore(secondHarness.ctx)
    const second = await convertImagesToEvidence(
      secondHarness.ctx,
      () => runtimeStub(recoveredGlance),
      new EvidenceCache(4, secondStore),
      [imageMessage()],
      undefined,
      secondHarness.sessionId,
      'a'.repeat(64),
    )
    expect(recoveredGlance).not.toHaveBeenCalled()
    expect(records.size).toBe(1)
    expect(secondHarness.attachments.readImage).not.toHaveBeenCalled()
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    secondStore.dispose()

    const changedHarness = storageHarness({ records, workspace })
    const changedStore = new SessionEvidenceStore(changedHarness.ctx)
    await convertImagesToEvidence(
      changedHarness.ctx,
      () => runtimeStub(recoveredGlance),
      new EvidenceCache(4, changedStore),
      [imageMessage()],
      undefined,
      changedHarness.sessionId,
      'b'.repeat(64),
    )
    expect(recoveredGlance).toHaveBeenCalledTimes(1)
    expect(records.size).toBe(2)
    changedStore.dispose()
  })

  it('coalesces concurrent Session flushes before writing sidecar records', async () => {
    const workspace = await tempRoot()
    const harness = storageHarness({ workspace })
    let releaseFlush: ((participated: boolean) => void) | undefined
    harness.sessions.flush.mockImplementation(async () => await new Promise<boolean>((resolve) => {
      releaseFlush = resolve
    }))
    const store = new SessionEvidenceStore(harness.ctx)
    const sessionIdentity = { createdAt: 1, cwd: workspace }
    const key = (attachmentId: string) => createEvidenceCacheKey({
      sessionId: harness.sessionId,
      sessionIdentity,
      attachmentId,
      prompt: 'same prompt',
      runtimeHash: 'a'.repeat(64),
    })

    const writes = [
      store.write(key('a'), { type: 'text', text: 'first' }),
      store.write(key('b'), { type: 'text', text: 'second' }),
    ]
    await vi.waitFor(() => { expect(harness.sessions.flush).toHaveBeenCalledTimes(1) })
    expect(harness.records.size).toBe(0)
    releaseFlush?.(true)
    await Promise.all(writes)

    expect(harness.records.size).toBe(2)
    store.dispose()
  })

  it('falls back to process memory when the Session or durable domain is unavailable', async () => {
    const workspace = await tempRoot()
    const noSessionHarness = storageHarness({ workspace })
    noSessionHarness.sessions.get.mockReturnValue(undefined)
    const glance = vi.fn(async () => glanceResult('process only'))
    const noSessionStore = new SessionEvidenceStore(noSessionHarness.ctx)
    const messages = [imageMessage()]
    await convertImagesToEvidence(
      noSessionHarness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, noSessionStore),
      messages,
      undefined,
      noSessionHarness.sessionId,
      'a'.repeat(64),
    )
    await convertImagesToEvidence(
      noSessionHarness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, noSessionStore),
      messages,
      undefined,
      noSessionHarness.sessionId,
      'a'.repeat(64),
    )
    expect(glance).toHaveBeenCalledTimes(2)
    noSessionStore.dispose()

    const brokenHarness = storageHarness({ workspace, openError: new Error('invalid-record') })
    const brokenStore = new SessionEvidenceStore(brokenHarness.ctx)
    const converted = await convertImagesToEvidence(
      brokenHarness.ctx,
      () => runtimeStub(glance),
      new EvidenceCache(4, brokenStore),
      messages,
      undefined,
      brokenHarness.sessionId,
      'a'.repeat(64),
    )
    expect(converted[0]?.content).toContainEqual({ type: 'text', text: expect.stringContaining('process only') })
    expect(brokenHarness.logger.warn).toHaveBeenCalledTimes(1)
    brokenStore.dispose()
  })

  it('bounds durable records by count and total UTF-8 bytes', async () => {
    const workspace = await tempRoot()
    const harness = storageHarness({ workspace })
    let now = 0
    const store = new SessionEvidenceStore(harness.ctx, {
      maxEntries: 2,
      maxBytes: 10_000,
      maxEntryBytes: 8,
      now: () => { now += 1; return now },
    })
    const sessionIdentity = { createdAt: 1, cwd: workspace }
    const key = (attachmentId: string) => createEvidenceCacheKey({
      sessionId: harness.sessionId,
      sessionIdentity,
      attachmentId,
      prompt: 'same prompt',
      runtimeHash: 'a'.repeat(64),
    })
    const block = (text: string): ContentBlock => ({ type: 'text', text })

    await store.write(key('a'), block('123456'))
    await store.write(key('b'), block('abcdef'))
    await store.write(key('c'), block('uvwxyz'))

    expect(harness.records.size).toBe(2)
    expect(harness.records.has(key('a').digest)).toBe(false)
    expect(harness.records.has(key('b').digest)).toBe(true)
    expect(harness.records.has(key('c').digest)).toBe(true)
    await store.write(key('too-large'), block('123456789'))
    expect(harness.records.size).toBe(2)
    store.dispose()

    const byteHarness = storageHarness({ workspace })
    let byteNow = 0
    const probe = new SessionEvidenceStore(byteHarness.ctx, {
      maxEntries: 10,
      maxBytes: 10_000,
      now: () => { byteNow += 1; return byteNow },
    })
    const byteKey = (attachmentId: string) => createEvidenceCacheKey({
      sessionId: byteHarness.sessionId,
      sessionIdentity,
      attachmentId,
      prompt: 'same prompt',
      runtimeHash: 'a'.repeat(64),
    })
    await probe.write(byteKey('a'), block('same-size'))
    const firstStored = [...byteHarness.records.values()][0]
    expect(typeof firstStored).toBe('string')
    const byteLimit = Buffer.byteLength(firstStored as string, 'utf8') + 16
    probe.dispose()

    const byteBounded = new SessionEvidenceStore(byteHarness.ctx, {
      maxEntries: 10,
      maxBytes: byteLimit,
      now: () => { byteNow += 1; return byteNow },
    })
    await byteBounded.write(byteKey('b'), block('same-size'))
    expect(byteHarness.records.size).toBe(1)
    expect(byteHarness.records.has(byteKey('b').digest)).toBe(true)
    byteBounded.dispose()
  })

  it('treats an individually corrupted sidecar record as a cache miss and replaces it', async () => {
    const workspace = await tempRoot()
    const harness = storageHarness({ workspace })
    const key = createEvidenceCacheKey({
      sessionId: harness.sessionId,
      sessionIdentity: { createdAt: 1, cwd: workspace },
      attachmentId: 'attachment-a',
      prompt: 'focus',
      runtimeHash: 'a'.repeat(64),
    })
    harness.records.set(key.digest, '{not-json')
    const store = new SessionEvidenceStore(harness.ctx)
    const load = vi.fn(async () => ({ type: 'text' as const, text: '[vision model description] repaired' }))

    const result = await new EvidenceCache(4, store).read(key, load)

    expect(result).toEqual({ type: 'text', text: '[vision model description] repaired' })
    expect(load).toHaveBeenCalledTimes(1)
    const stored = harness.records.get(key.digest)
    expect(typeof stored).toBe('string')
    expect(() => JSON.parse(stored as string)).not.toThrow()
    store.dispose()
  })

  it('includes output-affecting provider configuration in the runtime fingerprint', () => {
    const baseline = resolveConfig()
    const same = resolveConfig()
    const otherModel = resolveConfig({ provider: { model: 'another-vision-model' } })
    const otherLanguage = resolveConfig({ language: 'en' })
    const firstCredential = 'a'.repeat(64)
    const secondCredential = 'b'.repeat(64)

    expect(evidenceRuntimeFingerprint(baseline)).toMatch(/^[0-9a-f]{64}$/u)
    expect(evidenceRuntimeFingerprint(same)).toBe(evidenceRuntimeFingerprint(baseline))
    expect(evidenceRuntimeFingerprint(otherModel)).not.toBe(evidenceRuntimeFingerprint(baseline))
    expect(evidenceRuntimeFingerprint(otherLanguage)).not.toBe(evidenceRuntimeFingerprint(baseline))
    expect(evidenceRuntimeFingerprint(baseline, firstCredential))
      .not.toBe(evidenceRuntimeFingerprint(baseline, secondCredential))
  })
})
