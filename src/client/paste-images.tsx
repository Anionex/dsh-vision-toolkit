/** Clipboard-only multi-image input for DSH Web. */

import { useSyncExternalStore, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

const SOURCE = 'vision-toolkit-pasted-image'
export const PASTE_IMAGES_ROUTE = '/_dsh/vision-toolkit/paste-images'
export const PASTE_POLICY_ROUTE = '/_dsh/vision-toolkit/paste-policy'
const MAX_IMAGES = 20
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_BATCH_BYTES = 80 * 1024 * 1024
/** A confirmed paste verdict older than this is unknown again, even while a refresh is in flight. */
const VERDICT_MAX_AGE_MS = 15000

interface PasteRecord {
  ref: string
  file: File
  batch: PasteBatch
  status: 'ready' | 'copying' | 'copied' | 'error'
  error?: string | undefined
  absolutePath?: string | undefined
}

interface PasteBatch {
  sessionId: string
  records: PasteRecord[]
  inflight?: Promise<void> | undefined
  unsubscribe?: (() => void) | undefined
}

interface PasteResponse {
  ok: boolean
  value?: { absolutePath?: string }
  error?: { message?: string }
}

interface PasteOccurrence {
  occurrenceId: number
  source: string
  ref: string
  offset: number
  label: string
}

type PasteDockProps = PropsRuntime<'conversation.input.dock'> & {
  controller: PasteImageController
  remove: (occurrence: PasteOccurrence) => void
}

interface ReferenceSourceRegistry {
  registerSource: (source: InputTriggerSource) => () => void
}

interface ReferenceSourceRegistration {
  dispose: () => void
  owners: number
}

interface LegacyTriggerContext {
  inputTriggers: ReferenceSourceRegistry
}

interface LegacySlashContext {
  slash: ReferenceSourceRegistry
}

const CORDIS_ORIGINAL = Symbol.for('cordis.original')

function registryIdentity(registry: ReferenceSourceRegistry): object {
  let current: object = registry
  while (true) {
    const original = (current as Record<symbol, unknown>)[CORDIS_ORIGINAL]
    if ((typeof original !== 'object' && typeof original !== 'function') || original === null || original === current) {
      return current
    }
    current = original
  }
}

let fallbackId = 0

function id(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  fallbackId += 1
  return `paste-${Date.now()}-${fallbackId}`
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function imageFiles(data: DataTransfer | null): File[] {
  if (data === null) return []
  const itemFiles = Array.from(data.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  const candidates = itemFiles.length > 0 ? itemFiles : Array.from(data.files)
  return candidates.filter(file => file.type.toLowerCase().startsWith('image/'))
}

function validateImages(files: readonly File[]): void {
  if (files.length > MAX_IMAGES) throw new Error(`Paste at most ${MAX_IMAGES} images at a time`)
  let total = 0
  for (const file of files) {
    if (!file.type.toLowerCase().startsWith('image/')) throw new Error(`${file.name || 'clipboard item'} is not an image`)
    if (file.size <= 0) throw new Error(`${file.name || 'clipboard image'} is empty`)
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name || 'clipboard image'} exceeds ${humanBytes(MAX_IMAGE_BYTES)}`)
    total += file.size
  }
  if (total > MAX_BATCH_BYTES) throw new Error(`Pasted images exceed ${humanBytes(MAX_BATCH_BYTES)} in total`)
}

async function responseJson(response: Response): Promise<PasteResponse> {
  const body = await response.json() as PasteResponse
  if (!response.ok || body.ok !== true) throw new Error(body.error?.message ?? `Image copy failed (${response.status})`)
  return body
}

function pasteLabel(file: File, index: number): string {
  return file.name.trim() || `clipboard-image-${index + 1}`
}

/** Owns browser File objects until DSH serializes the corresponding text references. */
export class PasteImageController {
  private readonly records = new Map<string, PasteRecord>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private readonly verdicts = new Map<string, { takeOver: boolean; at: number; pending: boolean }>()
  private routeAvailable = true

  constructor(private readonly ctx: ClientContext) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot = (): number => this.revision

  private changed(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }

  source(): InputTriggerSource {
    return {
      trigger: '@',
      name: SOURCE,
      order: 1000,
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      codec: {
        clipboardText: ref => `[pasted image: ${this.records.get(ref)?.file.name ?? ref}]`,
        serialize: (ref, signal) => this.serialize(ref, signal),
      },
    }
  }

  recordsFor(occurrences: readonly PasteOccurrence[]): PasteRecord[] {
    return occurrences
      .filter(occurrence => occurrence.source === SOURCE)
      .map(occurrence => this.records.get(occurrence.ref))
      .filter((record): record is PasteRecord => record !== undefined)
  }

  private inputFor(sessionId: string) {
    const actx = this.ctx.sessions.scope(sessionId as never)
    if (actx === undefined) throw new Error('Open a live session before pasting images')
    return this.ctx.conversation.input.for(actx)
  }

  private insertText(input: ReturnType<PasteImageController['inputFor']>, text: string, start: number, end = start): number {
    if (text === '') return start
    const snapshot = input.state.getSnapshot()
    input.setDraft(snapshot.draft.slice(0, start) + text + snapshot.draft.slice(end))
    return start + text.length
  }

  private insertRecords(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    files: readonly File[],
    cursor: number,
  ): number {
    const batch: PasteBatch = { sessionId, records: [] }
    const draftBeforeReferences = input.state.getSnapshot().draft
    try {
      const before = input.state.getSnapshot().draft.slice(0, cursor)
      if (before !== '' && !/\s$/u.test(before)) cursor = this.insertText(input, ' ', cursor)
      for (const [index, file] of files.entries()) {
        const ref = id()
        const record: PasteRecord = { ref, file, batch, status: 'ready' }
        batch.records.push(record)
        this.records.set(ref, record)
        const snapshot = input.state.getSnapshot()
        const accepted = input.insertReference({
          source: SOURCE,
          ref,
          label: pasteLabel(file, index),
          clipboardText: `[pasted image: ${pasteLabel(file, index)}]`,
        }, { start: cursor, end: cursor, draftRev: snapshot.draftRev })
        if (!accepted) throw new Error('The composer changed before pasted images could be inserted')
        cursor += 1
        const hasNext = index + 1 < files.length
        const suffix = input.state.getSnapshot().draft.slice(cursor)
        if (hasNext || (suffix !== '' && !/^\s/u.test(suffix))) cursor = this.insertText(input, ' ', cursor)
      }
      batch.unsubscribe = input.state.subscribe(() => {
        const alive = new Set(input.state.getSnapshot().occurrences
          .filter(occurrence => occurrence.source === SOURCE)
          .map(occurrence => occurrence.ref))
        let changed = false
        for (const record of batch.records) {
          if (alive.has(record.ref) || record.batch.inflight !== undefined) continue
          changed = this.records.delete(record.ref) || changed
        }
        if (batch.records.every(record => !this.records.has(record.ref)) && batch.inflight === undefined) {
          batch.unsubscribe?.()
          batch.unsubscribe = undefined
        }
        if (changed) this.changed()
      })
      this.changed()
      return cursor
    } catch (error) {
      input.setDraft(draftBeforeReferences)
      for (const record of batch.records) this.records.delete(record.ref)
      throw error
    }
  }

  /**
   * Whether to take a paste over for one Session, from the host's cached
   * verdict. Unconfirmed or stale answers false, so the native attachment
   * flow is the default; the host refreshes in the background.
   * @param sessionId - the live Session the paste belongs to.
   * @returns true only for a fresh confirmed text-only verdict.
   */
  private verdictFor(sessionId: string): boolean {
    const entry = this.verdicts.get(sessionId)
    if (entry === undefined || entry.at === 0 || !entry.takeOver) return false
    return Date.now() - entry.at <= VERDICT_MAX_AGE_MS
  }

  /**
   * Ask the host whether the current model is text-only, and cache the answer
   * per Session. A 404 means the host route is off, so the client stands down
   * entirely instead of swallowing pastes into a dead endpoint.
   * @param sessionId - the live Session to ask about.
   */
  refreshVerdict(sessionId: string): void {
    if (!this.routeAvailable) return
    const cached = this.verdicts.get(sessionId)
    // Dedupe only on an in-flight request, never on freshness: the host's
    // model route can change under an unchanged Session id.
    if (cached?.pending) return
    const entry = { pending: true, takeOver: cached ? cached.takeOver : false, at: cached ? cached.at : 0 }
    this.verdicts.set(sessionId, entry)
    let request: Promise<Response>
    try {
      request = fetch(`${PASTE_POLICY_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`)
    } catch {
      // No fetch surface (test runtime, pre-fetch bootstrap): leave the
      // verdict unconfirmed rather than letting the paste listener die.
      entry.pending = false
      return
    }
    request
      .then((response) => {
        if (response.status === 404) {
          this.routeAvailable = false
          this.verdicts.clear()
          return null
        }
        if (!response.ok) throw new Error(`paste policy ${response.status}`)
        return response.json() as Promise<{ ok: true; value: { takeOver: boolean } }>
      })
      .then((body) => {
        entry.pending = false
        if (body !== null) {
          entry.takeOver = body.value.takeOver === true
          entry.at = Date.now()
        }
      })
      .catch(() => {
        entry.pending = false
      })
  }

  handlePaste(event: ClipboardEvent): boolean {
    const files = imageFiles(event.clipboardData)
    if (files.length === 0) return false
    const target = event.target
    if (!(target instanceof HTMLTextAreaElement) || target.closest('[data-composer-card]') === null) return false

    const sessionId = this.ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) return false
    this.refreshVerdict(sessionId)
    // Only a host-confirmed text-only model gets the path flow; image-capable
    // models (including the image-input variants) keep the native attachment
    // flow, which is what preserves the composer thumbnail and the durable
    // session image.
    if (!this.verdictFor(sessionId)) return false

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const input = this.inputFor(sessionId)
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain') return true

    const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length))
    const end = Math.max(start, Math.min(target.selectionEnd ?? start, snapshot.draft.length))
    const text = (event.clipboardData?.getData('text/plain') ?? '').replaceAll('\uFFFC', '')
    try {
      let cursor = this.insertText(input, text, start, end)
      validateImages(files)
      cursor = this.insertRecords(String(sessionId), input, files, cursor)
      requestAnimationFrame(() => {
        target.focus({ preventScroll: true })
        target.setSelectionRange(cursor, cursor)
      })
    } catch (error) {
      input.notify('error', message(error))
    }
    return true
  }

  remove(sessionId: string, occurrence: PasteOccurrence): void {
    const record = this.records.get(occurrence.ref)
    if (record?.batch.inflight !== undefined) return
    const input = this.inputFor(sessionId)
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain') return
    const current = snapshot.occurrences.find(candidate =>
      candidate.source === SOURCE
      && candidate.occurrenceId === occurrence.occurrenceId
      && candidate.ref === occurrence.ref)
    if (current === undefined) return
    const accepted = (input as typeof input & {
      insertText: (text: string, span: { start: number; end: number; draftRev: number }) => boolean
    }).insertText('', {
      start: current.offset,
      end: current.offset + 1,
      draftRev: snapshot.draftRev,
    })
    if (!accepted) return
    this.records.delete(occurrence.ref)
    this.changed()
  }

  private async upload(batch: PasteBatch, signal: AbortSignal): Promise<void> {
    if (batch.inflight !== undefined) return batch.inflight
    const active = batch.records.filter(record => this.records.get(record.ref) === record)
    if (active.length === 0) throw new Error('Pasted images were removed before sending')
    const pending = active.filter(record => record.absolutePath === undefined)
    if (pending.length === 0) return
    const task = (async () => {
      for (const record of pending) {
        record.status = 'copying'
        record.error = undefined
      }
      this.changed()
      try {
        const failures = await Promise.all(pending.map(async (record) => {
          try {
            if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
            const query = new URLSearchParams({
              sessionId: batch.sessionId,
              name: record.file.name || 'clipboard-image',
              size: String(record.file.size),
            })
            const body = await responseJson(await fetch(`${PASTE_IMAGES_ROUTE}?${query.toString()}`, {
              method: 'POST',
              headers: { 'Content-Type': record.file.type },
              body: record.file,
              signal,
            }))
            const absolutePath = body.value?.absolutePath
            if (typeof absolutePath !== 'string' || absolutePath === '') {
              throw new Error('Image copy response contained an invalid path')
            }
            record.absolutePath = absolutePath
            record.status = 'copied'
            record.error = undefined
            return undefined
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(message(error))
            record.status = 'error'
            record.error = failure.message
            return failure
          }
        }))
        this.changed()
        const failure = failures.find((error): error is Error => error !== undefined)
        if (failure !== undefined) throw failure
      } finally {
        batch.inflight = undefined
        this.changed()
      }
    })()
    batch.inflight = task
    return task
  }

  private async serialize(ref: string, signal: AbortSignal): Promise<string> {
    const record = this.records.get(ref)
    if (record === undefined) throw new Error('Pasted image is no longer available in this browser tab')
    await this.upload(record.batch, signal)
    if (record.absolutePath === undefined) throw new Error('Pasted image was not copied into the workspace')
    return `[Pasted image available at absolute path: ${JSON.stringify(record.absolutePath)}]`
  }
}

/** Minimal per-image progress, failure, and removal feedback above the composer. */
export function PasteImageDock(props: PasteDockProps): ReactNode {
  useSyncExternalStore(props.controller.subscribe, props.controller.snapshot)
  const occurrences = props.input.occurrences.filter(occurrence => occurrence.source === SOURCE)
  const records = props.controller.recordsFor(occurrences)
  if (records.length === 0) return null
  return <div className="dvt-paste-dock" role="status" aria-label="Pasted images">
    {occurrences.map((occurrence) => {
      const record = props.controller.recordsFor([occurrence])[0]
      if (record === undefined) return null
      const detail = record.status === 'copying' ? 'copying…'
        : record.status === 'copied' ? 'copied'
          : record.status === 'error' ? record.error ?? 'copy failed'
            : humanBytes(record.file.size)
      return <div className="dvt-paste-chip" data-status={record.status} key={occurrence.occurrenceId}>
        <span className="dvt-paste-name" title={record.file.name}>{record.file.name || 'clipboard image'}</span>
        <span className="dvt-paste-detail" title={record.error}>{detail}</span>
        <button
          type="button"
          aria-label={`Remove ${record.file.name || 'clipboard image'}`}
          disabled={props.input.phase !== 'plain' || record.status === 'copying'}
          onClick={() => { props.remove(occurrence) }}
        >×</button>
      </div>
    })}
  </div>
}

/** Install capture interception, the text-reference codec, and composer feedback. */
export function installPasteImages(ctx: ClientContext): void {
  const controller = new PasteImageController(ctx)
  const registered = new WeakMap<object, ReferenceSourceRegistration>()
  const register = (scope: ClientContext, registry: ReferenceSourceRegistry): void => {
    scope.effect(() => {
      const identity = registryIdentity(registry)
      let registration = registered.get(identity)
      if (registration === undefined) {
        registration = { dispose: registry.registerSource(controller.source()), owners: 0 }
        registered.set(identity, registration)
      }
      registration.owners += 1
      return () => {
        if (registered.get(identity) !== registration) return
        registration.owners -= 1
        if (registration.owners > 0) return
        registered.delete(identity)
        registration.dispose()
      }
    }, 'dsh-vision-toolkit: pasted image reference codec')
  }
  ctx.inject(['slash'], (scope: ClientContext) => {
    register(scope, (scope as unknown as LegacySlashContext).slash)
  })
  ctx.inject(['inputTriggers'], (scope: ClientContext) => {
    register(scope, (scope as unknown as LegacyTriggerContext).inputTriggers)
  })
  ctx.effect(() => {
    const listener = (event: ClipboardEvent): void => { controller.handlePaste(event) }
    // A focus-time prefetch has the verdict ready before the first paste can land.
    const onFocusIn = (): void => {
      const sessionId = ctx.sessions.list.getSnapshot().current
      if (sessionId !== undefined) controller.refreshVerdict(String(sessionId))
    }
    document.addEventListener('paste', listener, true)
    document.addEventListener('focusin', onFocusIn, true)
    return () => {
      document.removeEventListener('paste', listener, true)
      document.removeEventListener('focusin', onFocusIn, true)
    }
  }, 'dsh-vision-toolkit: clipboard image capture')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'vision-toolkit-pasted-images',
    order: 6,
    inject: sessionId => ({
      controller,
      remove: (occurrence: PasteOccurrence) => { controller.remove(String(sessionId), occurrence) },
    }),
  }, PasteImageDock))
}
