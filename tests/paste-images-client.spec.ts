// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  installPasteImages,
  PASTE_IMAGES_ROUTE as CLIENT_PASTE_IMAGES_ROUTE,
  PASTE_POLICY_ROUTE,
  PasteImageController,
} from '../src/client/paste-images.tsx'
import { PASTE_IMAGES_ROUTE as SERVER_PASTE_IMAGES_ROUTE, PASTE_POLICY_ROUTE as SERVER_PASTE_POLICY_ROUTE } from '../src/paste-images.ts'

interface Occurrence {
  occurrenceId: number
  source: string
  ref: string
  offset: number
  length?: number
  label: string
  clipboardText: string
}

type ReferenceDraftMode = 'placeholder' | 'display-text'

function inputMachine(initial = '', referenceDraftMode: ReferenceDraftMode = 'placeholder') {
  let state = {
    draft: initial,
    draftRev: 0,
    phase: 'plain' as const,
    imageIds: [] as string[],
    occurrences: [] as Occurrence[],
    queue: [],
  }
  const listeners = new Set<() => void>()
  const publish = (next: typeof state) => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    state: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    setDraft: vi.fn((draft: string) => {
      let start = 0
      while (start < state.draft.length && start < draft.length && state.draft[start] === draft[start]) start += 1
      let oldEnd = state.draft.length
      let newEnd = draft.length
      while (oldEnd > start && newEnd > start && state.draft[oldEnd - 1] === draft[newEnd - 1]) {
        oldEnd -= 1
        newEnd -= 1
      }
      const insertedLength = newEnd - start
      const delta = insertedLength - (oldEnd - start)
      const occurrences = state.occurrences.flatMap((occurrence) => {
        const end = occurrence.offset + (occurrence.length ?? 1)
        if (end <= start) return [occurrence]
        if (occurrence.offset >= oldEnd) return [{ ...occurrence, offset: occurrence.offset + delta }]
        return []
      })
      publish({ ...state, draft, draftRev: state.draftRev + 1, occurrences })
    }),
    insertReference: vi.fn((reference: Omit<Occurrence, 'occurrenceId' | 'offset'>, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== state.draftRev || span.start !== span.end) return false
      const text = referenceDraftMode === 'display-text' ? `@${reference.label}` : '\uFFFC'
      const tail = state.draft.slice(span.end)
      const inserted = text + (tail === '' || tail[0] !== ' ' ? ' ' : '')
      const occurrence = {
        ...reference,
        occurrenceId: state.occurrences.length + 1,
        offset: span.start,
        ...(referenceDraftMode === 'display-text' ? { length: text.length } : {}),
      }
      const shifted = state.occurrences.map(row => row.offset >= span.start ? { ...row, offset: row.offset + inserted.length } : row)
      publish({
        ...state,
        draft: state.draft.slice(0, span.start) + inserted + tail,
        draftRev: state.draftRev + 1,
        occurrences: [...shifted, occurrence].sort((a, b) => a.offset - b.offset),
      })
      return true
    }),
    insertText: vi.fn((text: string, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== state.draftRev || span.start > span.end) return false
      const draft = state.draft.slice(0, span.start) + text + state.draft.slice(span.end)
      const delta = text.length - (span.end - span.start)
      const occurrences = state.occurrences
        .filter(row => row.offset < span.start || row.offset >= span.end)
        .map(row => row.offset >= span.end ? { ...row, offset: row.offset + delta } : row)
      publish({ ...state, draft, draftRev: state.draftRev + 1, occurrences })
      return true
    }),
    addImages: vi.fn((files: File[]) => {
      const next = [...state.imageIds, ...files.map((_, index) => `draft-image-${state.imageIds.length + index}`)]
      publish({ ...state, imageIds: next })
      return true
    }),
    notify: vi.fn(),
  }
}

type TriggerService = 'slash' | 'inputTriggers'

function fakeClient(
  initial = '',
  triggerServices: readonly TriggerService[] = ['slash'],
  aliasTriggers = false,
  referenceDraftMode: ReferenceDraftMode = 'placeholder',
) {
  const input = inputMachine(initial, referenceDraftMode)
  const effects: Array<() => void> = []
  const registrations: Array<{
    options: Record<string, unknown>
    component: ComponentType<Record<string, unknown>>
  }> = []
  let source: ReturnType<PasteImageController['source']> | undefined
  const createTriggerRegistry = () => {
    const dispose = vi.fn(() => { source = undefined })
    return {
      dispose,
      registerSource: vi.fn((next: ReturnType<PasteImageController['source']>) => {
        source = next
        return dispose
      }),
    }
  }
  const triggerRegistries = {
    slash: createTriggerRegistry(),
    inputTriggers: createTriggerRegistry(),
  }
  const ctx: Record<string, unknown> = {
    sessions: {
      list: { getSnapshot: () => ({ current: 'session-1' }) },
      scope: () => ({}),
    },
    conversation: { input: { for: () => input } },
    slots: {
      inject: vi.fn((_name: string, callback: () => unknown) => { callback() }),
      register: vi.fn((options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>) => {
        registrations.push({ options, component })
        return () => {}
      }),
    },
    effect: vi.fn((setup: () => void | (() => void)) => {
      const dispose = setup()
      if (typeof dispose === 'function') effects.push(dispose)
    }),
  }
  ctx.get = (key: string) => ctx[key]
  for (const service of triggerServices) {
    ctx[service] = aliasTriggers ? triggerRegistries.slash : triggerRegistries[service]
  }
  ctx.inject = vi.fn((services: string[], callback: (scope: typeof ctx) => void) => {
    if (services.every(service => ctx[service] !== undefined)) callback(ctx)
  })
  installPasteImages(ctx as never)
  return {
    ctx,
    input,
    registrations,
    source: () => source,
    triggerRegistries,
    disposeEffect: (index: number) => {
      const dispose = effects[index]
      if (dispose === undefined) return
      effects[index] = () => {}
      dispose()
    },
    dispose: () => effects.reverse().forEach(fn => { fn() }),
  }
}

function file(name: string, type: string, bytes: number[]): File {
  const value = new File([Uint8Array.from(bytes)], name, { type })
  Object.defineProperty(value, 'arrayBuffer', { value: async () => Uint8Array.from(bytes).buffer })
  return value
}

function clipboardEvent(text: string, files: File[]): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  const data = {
    items: files.map(value => ({ kind: 'file', type: value.type, getAsFile: () => value })),
    files,
    getData: (type: string) => type === 'text/plain' ? text : '',
  }
  Object.defineProperty(event, 'clipboardData', { value: data })
  return event
}

function composer(): HTMLTextAreaElement {
  const card = document.createElement('div')
  card.dataset.composerCard = ''
  const textarea = document.createElement('textarea')
  card.appendChild(textarea)
  document.body.appendChild(card)
  return textarea
}

function policyResponse(takeOver: boolean, autoSwitch?: { provider: string; model: string; label: string; reasoningEffort?: string }): Response {
  return new Response(JSON.stringify({
    ok: true,
    value: { takeOver, ...(autoSwitch === undefined ? {} : { autoSwitch }) },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Wrap an upload fetch mock so host verdict re-asks short-circuit before any
 * upload assertion (every paste refreshes the verdict).
 */
function uploadMock(handle: (url: string, init: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/_dsh/vision-toolkit/paste-policy')) return policyResponse(true)
    return handle(url, init ?? ({} as RequestInit))
  })
}

/** Upload-only calls of a fetch mock, excluding verdict re-asks. */
function uploadsOf(mock: ReturnType<typeof vi.fn>): Array<[string, RequestInit]> {
  return mock.mock.calls.filter(([url]) => !String(url).includes('paste-policy')) as Array<[string, RequestInit]>
}

/**
 * Seed a confirmed host verdict, the way a focus into the composer does.
 * Runs the policy fetch under its own stub, then restores the global fetch so
 * the test can stub the upload route next.
 */
async function confirmTakeover(bench: ReturnType<typeof fakeClient>): Promise<void> {
  const policy = vi.fn(async () => policyResponse(true))
  vi.stubGlobal('fetch', policy)
  document.dispatchEvent(new Event('focusin'))
  await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
  // Let the response microtasks settle into the verdict cache.
  await new Promise(resolve => setTimeout(resolve, 0))
  vi.unstubAllGlobals()
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('clipboard image client', () => {
  it('uses the exact Web routes registered by the server', () => {
    expect(CLIENT_PASTE_IMAGES_ROUTE).toBe(SERVER_PASTE_IMAGES_ROUTE)
    expect(PASTE_POLICY_ROUTE).toBe(SERVER_PASTE_POLICY_ROUTE)
  })

  it('registers the reference codec through the legacy inputTriggers service', () => {
    const bench = fakeClient('', ['inputTriggers'])
    expect(bench.source()?.name).toBe('vision-toolkit-pasted-image')
    expect(bench.ctx.inject).toHaveBeenCalledWith(['slash'], expect.any(Function))
    expect(bench.ctx.inject).toHaveBeenCalledWith(['inputTriggers'], expect.any(Function))
    bench.dispose()
  })

  it('registers both distinct trigger-service generations in a transitional runtime', () => {
    const bench = fakeClient('', ['slash', 'inputTriggers'])
    expect(bench.triggerRegistries.slash.registerSource).toHaveBeenCalledTimes(1)
    expect(bench.triggerRegistries.inputTriggers.registerSource).toHaveBeenCalledTimes(1)
    bench.dispose()
  })

  it('registers once when a compatibility adapter aliases both service names', () => {
    const bench = fakeClient('', ['slash', 'inputTriggers'], true)
    expect(bench.triggerRegistries.slash.registerSource).toHaveBeenCalledTimes(1)
    expect(bench.triggerRegistries.inputTriggers.registerSource).not.toHaveBeenCalled()
    bench.disposeEffect(0)
    expect(bench.source()?.name).toBe('vision-toolkit-pasted-image')
    expect(bench.triggerRegistries.slash.dispose).not.toHaveBeenCalled()
    bench.disposeEffect(1)
    expect(bench.source()).toBeUndefined()
    expect(bench.triggerRegistries.slash.dispose).toHaveBeenCalledTimes(1)
    bench.dispose()
  })

  it('keeps an aliased registry live across real Cordis service removal and re-provision', async () => {
    const ctx = new Context()
    const unregister = vi.fn()
    const registerSource = vi.fn(() => unregister)
    class TriggerRegistryService extends Service {
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'inputTriggers')
      }

      registerSource(): () => void {
        return registerSource()
      }
    }
    const mountAdapter = async () => {
      const fiber = ctx.plugin({
        inject: ['inputTriggers'],
        apply(scope: Context) {
          scope.provide('slash', (scope as Context & { inputTriggers: TriggerRegistryService }).inputTriggers)
        },
      })
      await fiber.await()
      return fiber
    }
    ctx.provide('sessions', {
      list: { getSnapshot: () => ({ current: 'session-1' }) },
      scope: () => ({}),
    })
    ctx.provide('conversation', { input: { for: () => inputMachine() } })
    ctx.provide('slots', {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: () => () => {},
    })
    let providerFiber = ctx.plugin(TriggerRegistryService)
    await providerFiber.await()
    let adapterFiber = await mountAdapter()
    const pasteFiber = ctx.plugin({ apply: scope => { installPasteImages(scope as never) } })
    await pasteFiber.await()
    await vi.waitFor(() => { expect(registerSource).toHaveBeenCalledTimes(1) })

    await adapterFiber.dispose()
    expect(unregister).not.toHaveBeenCalled()
    adapterFiber = await mountAdapter()
    expect(registerSource).toHaveBeenCalledTimes(1)

    await providerFiber.dispose()
    await vi.waitFor(() => { expect(unregister).toHaveBeenCalledTimes(1) })

    providerFiber = ctx.plugin(TriggerRegistryService)
    await providerFiber.await()
    await vi.waitFor(() => { expect(registerSource).toHaveBeenCalledTimes(2) })
    await adapterFiber.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
    await providerFiber.dispose()
    await vi.waitFor(() => { expect(unregister).toHaveBeenCalledTimes(2) })
    await pasteFiber.dispose()
  })

  it('preserves pasted text, inserts every image as a text reference, and blocks the native ImageBlock path', async () => {
    const bench = fakeClient('prefix ')
    await confirmTakeover(bench)
    const textarea = composer()
    textarea.value = 'prefix '
    textarea.setSelectionRange(7, 7)
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    let uploads = 0
    const request = uploadMock(async (_url, init) => {
      expect(init.body).toBeInstanceOf(File)
      const index = uploads
      uploads += 1
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: index === 0
          ? '/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-01.png'
          : '/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-02.webp' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)

    const event = clipboardEvent('caption\uFFFC', [
      file('one.png', 'image/png', [1]),
      file('notes.txt', 'text/plain', [9]),
      file('two.webp', 'image/webp', [2, 3]),
    ])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativePaste).not.toHaveBeenCalled()
    expect(bench.input.state.getSnapshot().draft).toContain('prefix caption')
    expect(bench.input.state.getSnapshot().draft.match(/\uFFFC/gu)).toHaveLength(2)
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(2)
    expect(bench.input.state.getSnapshot().imageIds).toEqual([])

    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const refs = bench.input.state.getSnapshot().occurrences.map(row => row.ref)
    const serialized = await Promise.all(refs.map(ref => codec.serialize(ref, new AbortController().signal)))
    expect(uploads).toBe(2)
    expect(uploadsOf(request).every(([url]) => String(url).startsWith('/_dsh/vision-toolkit/paste-images?'))).toBe(true)
    expect(serialized).toEqual([
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-01.png"]',
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-02.webp"]',
    ])
    bench.dispose()
  })

  it.each([
    {
      name: 'the legacy one-character placeholder draft',
      mode: 'placeholder' as const,
      files: [file('one.png', 'image/png', [1]), file('two.webp', 'image/webp', [2])],
      expectedDraft: '\uFFFC \uFFFC ',
      expectedCaret: 3,
    },
    {
      name: 'the rc.8+ display-text draft',
      mode: 'display-text' as const,
      files: [file('one.png', 'image/png', [1]), file('two.webp', 'image/webp', [2])],
      expectedDraft: '@one.png @two.webp ',
      expectedCaret: 18,
    },
  ])('places every reference and the final caret correctly with $name', async ({ mode, files, expectedDraft, expectedCaret }) => {
    const bench = fakeClient('', ['slash'], false, mode)
    await confirmTakeover(bench)
    const textarea = composer()

    textarea.dispatchEvent(clipboardEvent('', files))

    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).toBe(expectedDraft)
    expect(snapshot.occurrences).toHaveLength(2)
    textarea.value = snapshot.draft
    await vi.waitFor(() => {
      expect(textarea.selectionStart).toBe(expectedCaret)
      expect(textarea.selectionEnd).toBe(expectedCaret)
    })
    bench.dispose()
  })

  it('ignores non-image clipboard files so ordinary text paste remains native', () => {
    const bench = fakeClient('before ')
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    const event = clipboardEvent('plain text', [file('notes.txt', 'text/plain', [1])])

    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(nativePaste).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().draft).toBe('before ')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    bench.dispose()
  })

  it('preserves same-paste text when image admission fails', async () => {
    const bench = fakeClient('before ')
    await confirmTakeover(bench)
    const textarea = composer()
    textarea.value = 'before '
    textarea.setSelectionRange(7, 7)
    const images = Array.from({ length: 21 }, (_, index) => file(`${index}.png`, 'image/png', [index]))
    const event = clipboardEvent('caption', images)

    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(bench.input.state.getSnapshot().draft).toBe('before caption')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(bench.input.notify).toHaveBeenCalledWith('error', 'Paste at most 20 images at a time')
    bench.dispose()
  })

  it('removes references through insertText so later occurrence offsets stay current', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    textarea.dispatchEvent(clipboardEvent('', [
      file('one.png', 'image/png', [1]),
      file('two.png', 'image/png', [2]),
      file('three.png', 'image/png', [3]),
    ]))
    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    const original = bench.input.state.getSnapshot().occurrences
    const first = original[0]
    if (first === undefined) throw new Error('first occurrence was not inserted')
    const firstRev = bench.input.state.getSnapshot().draftRev

    injected.remove(first)

    expect(bench.input.insertText).toHaveBeenLastCalledWith('', {
      start: first.offset,
      end: first.offset + 1,
      draftRev: firstRev,
    })
    const afterFirst = bench.input.state.getSnapshot().occurrences
    expect(afterFirst.map(row => row.ref)).toEqual(original.slice(1).map(row => row.ref))
    expect(afterFirst.map(row => row.offset)).toEqual([1, 3])

    const staleLater = original[2]
    const currentLater = afterFirst[1]
    if (staleLater === undefined || currentLater === undefined) throw new Error('later occurrence was not retained')
    const laterRev = bench.input.state.getSnapshot().draftRev
    injected.remove(staleLater)

    expect(bench.input.insertText).toHaveBeenLastCalledWith('', {
      start: currentLater.offset,
      end: currentLater.offset + 1,
      draftRev: laterRev,
    })
    expect(bench.input.state.getSnapshot().occurrences.map(row => row.ref)).toEqual([original[1]?.ref])
    expect(injected.controller.recordsFor(original)).toHaveLength(1)
    bench.dispose()
  })

  it('removes the complete rc.8+ display-text reference instead of only its @ marker', async () => {
    const bench = fakeClient('', ['slash'], false, 'display-text')
    await confirmTakeover(bench)
    const textarea = composer()
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    const occurrence = bench.input.state.getSnapshot().occurrences[0]
    if (occurrence === undefined || occurrence.length === undefined) throw new Error('display-text occurrence was not inserted')
    const revision = bench.input.state.getSnapshot().draftRev

    injected.remove(occurrence)

    expect(bench.input.insertText).toHaveBeenLastCalledWith('', {
      start: occurrence.offset,
      end: occurrence.offset + occurrence.length,
      draftRev: revision,
    })
    expect(bench.input.state.getSnapshot().draft).toBe(' ')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(injected.controller.recordsFor([occurrence])).toEqual([])
    bench.dispose()
  })

  it('retains a pasted image record when the occurrence-aware removal is rejected', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    const occurrence = bench.input.state.getSnapshot().occurrences[0]
    if (occurrence === undefined) throw new Error('paste occurrence was not inserted')
    bench.input.insertText.mockReturnValueOnce(false)

    injected.remove(occurrence)

    expect(bench.input.state.getSnapshot().occurrences).toEqual([occurrence])
    expect(injected.controller.recordsFor([occurrence])).toHaveLength(1)
    bench.dispose()
  })

  it('reuses successful workspace paths and retries only records still missing a path', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    let secondAttempts = 0
    const request = uploadMock(async (url) => {
      const name = new URL(String(url), 'http://localhost').searchParams.get('name')
      if (name === 'one.png') {
        return new Response(JSON.stringify({
          ok: true,
          value: { absolutePath: '/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/stable-one.png' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      secondAttempts += 1
      if (secondAttempts === 1) {
        return new Response(JSON.stringify({
          ok: false,
          error: { message: 'second copy failed' },
        }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: '/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/retried-two.png' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)
    textarea.dispatchEvent(clipboardEvent('', [
      file('one.png', 'image/png', [1]),
      file('two.png', 'image/png', [2]),
    ]))
    const occurrences = bench.input.state.getSnapshot().occurrences
    const first = occurrences[0]
    const second = occurrences[1]
    if (first === undefined || second === undefined) throw new Error('paste occurrences were not inserted')
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')

    await expect(codec.serialize(first.ref, new AbortController().signal)).rejects.toThrow('second copy failed')
    expect(uploadsOf(request)).toHaveLength(2)

    const secondText = await codec.serialize(second.ref, new AbortController().signal)
    expect(uploadsOf(request)).toHaveLength(3)
    const names = uploadsOf(request).map(([url]) => new URL(String(url), 'http://localhost').searchParams.get('name'))
    expect(names).toEqual(['one.png', 'two.png', 'two.png'])
    expect(secondText).toBe('[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/retried-two.png"]')

    const firstText = await codec.serialize(first.ref, new AbortController().signal)
    expect(uploadsOf(request)).toHaveLength(3)
    expect(firstText).toBe('[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/stable-one.png"]')
    bench.dispose()
  })

  it('keeps failed serialization out of the model send and exposes retry/removal feedback', async () => {
    const bench = fakeClient('')
    await confirmTakeover(bench)
    const textarea = composer()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { message: 'workspace copy failed' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })))
    textarea.dispatchEvent(clipboardEvent('', [file('broken.png', 'image/png', [1])]))
    const occurrence = bench.input.state.getSnapshot().occurrences[0]
    if (occurrence === undefined) throw new Error('paste occurrence was not inserted')
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const modelSink = vi.fn()
    const send = async () => { modelSink(await codec.serialize(occurrence.ref, new AbortController().signal)) }

    await expect(send()).rejects.toThrow('workspace copy failed')
    expect(modelSink).not.toHaveBeenCalled()
    const dock = bench.registrations.find(row => row.options.id === 'vision-toolkit-pasted-images')
    expect(dock).toBeDefined()

    const injected = (dock?.options.inject as ((sessionId: string) => { controller: PasteImageController; remove: (row: Occurrence) => void }))('session-1')
    const controller = injected.controller
    expect(controller.recordsFor([occurrence])[0]?.status).toBe('error')
    if (dock === undefined) throw new Error('paste dock was not registered')
    render(createElement(dock.component, { input: bench.input.state.getSnapshot(), ...injected }))
    expect(screen.getByText('broken.png')).toBeTruthy()
    expect(screen.getByText('workspace copy failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove broken.png' }))
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(controller.recordsFor([occurrence])).toEqual([])
    bench.dispose()
  })

  it('prefetches the paste verdict when the composer gains focus', async () => {
    const bench = fakeClient('')
    const policy = vi.fn(async () => policyResponse(true))
    vi.stubGlobal('fetch', policy)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    expect(String(policy.mock.calls[0]?.[0])).toContain('paste-policy')
    expect(String(policy.mock.calls[0]?.[0])).toContain(encodeURIComponent('session-1'))
    bench.dispose()
  })

  it('leaves pastes native while the host verdict is unconfirmed', async () => {
    const bench = fakeClient('')
    // A pending policy response: the safe default is the native flow, so the
    // first paste on a text-only model keeps its ordinary admission error.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))

    expect(textarea.value).toBe('')
    expect(nativePaste).toHaveBeenCalledTimes(1)
    bench.dispose()
  })

  it('leaves pastes native when the host confirms an image-capable model', async () => {
    const bench = fakeClient('')
    vi.stubGlobal('fetch', vi.fn(async () => policyResponse(false)))
    document.dispatchEvent(new Event('focusin'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))

    expect(textarea.value).toBe('')
    expect(nativePaste).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    bench.dispose()
  })

  it('keeps pastes native while the policy route is down, then recovers on the next focus', async () => {
    const bench = fakeClient('')
    const policySpy = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', policySpy)
    document.dispatchEvent(new Event('focusin'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    // The paste re-asks and gets the same 404: native, no reference inserted.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(nativePaste).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(policySpy).toHaveBeenCalledTimes(2)
    // The route comes back: the next focus re-asks instead of standing down
    // for the page lifetime, and the following paste is taken over.
    policySpy.mockResolvedValue(policyResponse(true))
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policySpy).toHaveBeenCalledTimes(3) })
    // Let the recovered verdict land before pasting.
    await new Promise(resolve => setTimeout(resolve, 0))
    const nativeAfter = vi.fn()
    textarea.addEventListener('paste', nativeAfter)
    textarea.dispatchEvent(clipboardEvent('', [file('two.png', 'image/png', [2])]))
    expect(nativeAfter).not.toHaveBeenCalled()
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    bench.dispose()
  })

  it('keeps the paste native when the host vetoes the variant label', async () => {
    const bench = fakeClient('')
    const policy = vi.fn(async (url: string) => {
      const label = new URL(String(url), 'http://localhost').searchParams.get('model') ?? ''
      return policyResponse(!label.includes('(Vision Toolkit)'))
    })
    vi.stubGlobal('fetch', policy)
    const selector = document.createElement('button')
    selector.setAttribute('aria-label', 'Select model, current DeepSeek V4 Flash')
    document.body.appendChild(selector)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    expect(nativePaste).not.toHaveBeenCalled()
    // Switching to the image-input variant: the host vetoes the takeover and
    // the paste goes native — no reference, no prevented default.
    selector.setAttribute('aria-label', 'Select model, current DeepSeek V4 Flash (Vision Toolkit)')
    document.dispatchEvent(new Event('focusin'))
    // The switch is asked at least once under the new label (the takeover's
    // focus() may prefetch once more; only the ask under the variant label
    // matters).
    await vi.waitFor(() => {
      expect(policy.mock.calls.some(([url]) =>
        new URL(String(url), 'http://localhost').searchParams.get('model')?.includes('(Vision Toolkit)') === true)).toBe(true)
    })
    // Let the veto response land before pasting, so the native path is the
    // host's verdict, not the unconfirmed default.
    await new Promise(resolve => setTimeout(resolve, 0))
    const nativeAgain = vi.fn()
    textarea.addEventListener('paste', nativeAgain)
    textarea.dispatchEvent(clipboardEvent('', [file('two.png', 'image/png', [2])]))
    expect(nativeAgain).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    selector.remove()
    bench.dispose()
  })

  it('auto-switches to the variant, replays the paste into the native intake, and skips the path flow', async () => {
    const bench = fakeClient('')
    // The live model catalog reports the exact selection, and the model
    // directory is the switch channel the selector uses.
    const select = vi.fn(async () => {})
    bench.ctx.connection = {
      api: {
        sessions: {
          models: vi.fn(async () => ({
            result: { ok: true, value: { current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
          })),
        },
      },
    }
    bench.ctx.modelDirectories = { directoryFor: vi.fn(() => ({ select })) }
    const policy = vi.fn(async () => policyResponse(false, {
      provider: 'vision-toolkit-deepseek-official',
      model: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash (Vision Toolkit)',
    }))
    vi.stubGlobal('fetch', policy)
    // A clipboard payload the synthetic replay can carry (jsdom constructs
    // neither DataTransfer nor ClipboardEvent init data).
    class FakeDataTransfer {
      private stored: File[] = []
      items = { add: (file: File) => { this.stored.push(file) } }
      setData(): void {}
      get files(): File[] { return this.stored }
    }
    class FakeClipboardEvent extends Event {
      readonly clipboardData: { files: File[]; items: Array<{ kind: string; getAsFile: () => File }> } | null
      constructor(type: string, init: { clipboardData?: { files: File[] } } = {}) {
        super(type, init)
        const files = init.clipboardData?.files ?? []
        this.clipboardData = {
          files,
          items: files.map(file => ({ kind: 'file', getAsFile: () => file })),
        }
      }
    }
    vi.stubGlobal('DataTransfer', FakeDataTransfer)
    vi.stubGlobal('ClipboardEvent', FakeClipboardEvent as unknown as typeof ClipboardEvent)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))

    const textarea = composer()
    // Mimic the composer's own intake: files on a paste become draft images.
    textarea.addEventListener('paste', (event) => {
      const files = Array.from((event as ClipboardEvent).clipboardData?.files ?? [])
      if (files.length > 0) bench.input.addImages(files)
    })
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    textarea.dispatchEvent(clipboardEvent('caption', [
      file('one.png', 'image/png', [1]),
      file('two.webp', 'image/webp', [2, 3]),
    ]))

    await vi.waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'vision-toolkit-deepseek-official',
        model: 'deepseek-v4-flash',
      })
    })
    await vi.waitFor(() => {
      expect(bench.input.notify).toHaveBeenCalledWith('info', expect.stringContaining('Switched to'))
    })
    await vi.waitFor(() => {
      expect(bench.input.state.getSnapshot().imageIds).toHaveLength(2)
    })
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(nativePaste).toHaveBeenCalledTimes(1)
    bench.dispose()
  })

  it('carries the reasoning effort through the policy query and the switch', async () => {
    const bench = fakeClient('')
    const select = vi.fn(async () => {})
    bench.ctx.connection = {
      api: {
        sessions: {
          models: vi.fn(async () => ({
            result: {
              ok: true,
              value: { current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } },
            },
          })),
        },
      },
    }
    bench.ctx.modelDirectories = { directoryFor: vi.fn(() => ({ select })) }
    const policy = vi.fn(async (url: string) => {
      const query = new URL(String(url), 'http://localhost').searchParams
      expect(query.get('provider')).toBe('deepseek-official')
      expect(query.get('modelId')).toBe('deepseek-v4-flash')
      expect(query.get('reasoningEffort')).toBe('high')
      return policyResponse(false, {
        provider: 'vision-toolkit-deepseek-official',
        model: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash (Vision Toolkit)',
        reasoningEffort: 'high',
      })
    })
    vi.stubGlobal('fetch', policy)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    textarea.addEventListener('paste', (event) => {
      const files = Array.from((event as ClipboardEvent).clipboardData?.files ?? [])
      if (files.length > 0) bench.input.addImages(files)
    })
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))

    await vi.waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'vision-toolkit-deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
      })
    })
    bench.dispose()
  })

  it('degrades to the path takeover when the model switch fails', async () => {
    const bench = fakeClient('')
    const select = vi.fn(async () => { throw new Error('switch rejected') })
    bench.ctx.modelDirectories = { directoryFor: vi.fn(() => ({ select })) }
    const policy = vi.fn(async () => policyResponse(false, {
      provider: 'vision-toolkit-deepseek-official',
      model: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash (Vision Toolkit)',
    }))
    vi.stubGlobal('fetch', policy)
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))

    await vi.waitFor(() => {
      expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    })
    expect(bench.input.state.getSnapshot().imageIds).toEqual([])
    expect(bench.input.notify).toHaveBeenCalledWith('error', expect.stringContaining('switch rejected'))
    expect(bench.input.notify).not.toHaveBeenCalledWith('info', expect.anything())
    bench.dispose()
  })

  it('degrades to the path takeover when clipboard replay is unavailable', async () => {
    const bench = fakeClient('')
    const select = vi.fn(async () => {})
    bench.ctx.modelDirectories = { directoryFor: vi.fn(() => ({ select })) }
    const policy = vi.fn(async () => policyResponse(false, {
      provider: 'vision-toolkit-deepseek-official',
      model: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash (Vision Toolkit)',
    }))
    vi.stubGlobal('fetch', policy)
    vi.stubGlobal('DataTransfer', class { constructor() { throw new Error('no clipboard construction') } })
    document.dispatchEvent(new Event('focusin'))
    await vi.waitFor(() => { expect(policy).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 0))
    const textarea = composer()
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))

    await vi.waitFor(() => {
      expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    })
    expect(select).toHaveBeenCalledTimes(1)
    expect(bench.input.notify).toHaveBeenCalledWith('info', expect.anything())
    bench.dispose()
  })
})
