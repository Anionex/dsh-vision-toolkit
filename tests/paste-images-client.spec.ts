// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  installPasteImages,
  PASTE_IMAGES_ROUTE as CLIENT_PASTE_IMAGES_ROUTE,
  PasteImageController,
} from '../src/client/paste-images.tsx'
import { PASTE_IMAGES_ROUTE as SERVER_PASTE_IMAGES_ROUTE } from '../src/paste-images.ts'

interface Occurrence {
  occurrenceId: number
  source: string
  ref: string
  offset: number
  label: string
  clipboardText: string
}

function inputMachine(initial = '') {
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
      const occurrences = state.occurrences.filter(occurrence => draft[occurrence.offset] === '\uFFFC')
      publish({ ...state, draft, draftRev: state.draftRev + 1, occurrences })
    }),
    insertReference: vi.fn((reference: Omit<Occurrence, 'occurrenceId' | 'offset'>, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== state.draftRev || span.start !== span.end) return false
      const occurrence = { ...reference, occurrenceId: state.occurrences.length + 1, offset: span.start }
      const shifted = state.occurrences.map(row => row.offset >= span.start ? { ...row, offset: row.offset + 1 } : row)
      publish({
        ...state,
        draft: state.draft.slice(0, span.start) + '\uFFFC' + state.draft.slice(span.end),
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
    notify: vi.fn(),
  }
}

function fakeClient(initial = '') {
  const input = inputMachine(initial)
  const effects: Array<() => void> = []
  const registrations: Array<{
    options: Record<string, unknown>
    component: ComponentType<Record<string, unknown>>
  }> = []
  let source: ReturnType<PasteImageController['source']> | undefined
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ current: 'session-1' }) },
      scope: () => ({}),
    },
    conversation: { input: { for: () => input } },
    slash: {
      registerSource: vi.fn((next) => {
        source = next
        return () => { source = undefined }
      }),
    },
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
  installPasteImages(ctx as never)
  return { ctx, input, registrations, source: () => source, dispose: () => effects.reverse().forEach(fn => { fn() }) }
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

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('clipboard image client', () => {
  it('uses the exact Web route registered by the server', () => {
    expect(CLIENT_PASTE_IMAGES_ROUTE).toBe(SERVER_PASTE_IMAGES_ROUTE)
  })

  it('preserves pasted text, inserts every image as a text reference, and blocks the native ImageBlock path', async () => {
    const bench = fakeClient('prefix ')
    const textarea = composer()
    textarea.value = 'prefix '
    textarea.setSelectionRange(7, 7)
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    const request = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.body).toBeInstanceOf(File)
      const index = request.mock.calls.length - 1
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
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.every(([url]) => String(url).startsWith('/_dsh/vision-toolkit/paste-images?'))).toBe(true)
    expect(serialized).toEqual([
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-01.png"]',
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/image-02.webp"]',
    ])
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

  it('preserves same-paste text when image admission fails', () => {
    const bench = fakeClient('before ')
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

  it('removes references through insertText so later occurrence offsets stay current', () => {
    const bench = fakeClient('')
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

  it('retains a pasted image record when the occurrence-aware removal is rejected', () => {
    const bench = fakeClient('')
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
    const textarea = composer()
    let secondAttempts = 0
    const request = vi.fn(async (url: string) => {
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
    expect(request).toHaveBeenCalledTimes(2)

    const secondText = await codec.serialize(second.ref, new AbortController().signal)
    expect(request).toHaveBeenCalledTimes(3)
    const names = request.mock.calls.map(([url]) => new URL(String(url), 'http://localhost').searchParams.get('name'))
    expect(names).toEqual(['one.png', 'two.png', 'two.png'])
    expect(secondText).toBe('[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/retried-two.png"]')

    const firstText = await codec.serialize(first.ref, new AbortController().signal)
    expect(request).toHaveBeenCalledTimes(3)
    expect(firstText).toBe('[Pasted image available at absolute path: "/workspace/.dsh-vision-toolkit/tmp/pasted-images/a/stable-one.png"]')
    bench.dispose()
  })

  it('keeps failed serialization out of the model send and exposes retry/removal feedback', async () => {
    const bench = fakeClient('')
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
})
