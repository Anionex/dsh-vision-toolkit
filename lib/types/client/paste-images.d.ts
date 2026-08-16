/** Clipboard-only multi-image input for DSH Web. */
import { type ReactNode } from 'react';
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export declare const PASTE_IMAGES_ROUTE = "/_dsh/vision-toolkit/paste-images";
export declare const PASTE_POLICY_ROUTE = "/_dsh/vision-toolkit/paste-policy";
interface PasteRecord {
    ref: string;
    file: File;
    batch: PasteBatch;
    status: 'ready' | 'copying' | 'copied' | 'error';
    error?: string | undefined;
    absolutePath?: string | undefined;
}
interface PasteBatch {
    sessionId: string;
    records: PasteRecord[];
    inflight?: Promise<void> | undefined;
    unsubscribe?: (() => void) | undefined;
}
interface PasteOccurrence {
    occurrenceId: number;
    source: string;
    ref: string;
    offset: number;
    label: string;
}
type PasteDockProps = PropsRuntime<'conversation.input.dock'> & {
    controller: PasteImageController;
    remove: (occurrence: PasteOccurrence) => void;
};
/** Owns browser File objects until DSH serializes the corresponding text references. */
export declare class PasteImageController {
    private readonly ctx;
    private readonly records;
    private readonly listeners;
    private revision;
    private readonly verdicts;
    /** Guards the synthetic replay paste from re-entering capture interception. */
    private replaying;
    constructor(ctx: ClientContext);
    subscribe: (listener: () => void) => (() => void);
    snapshot: () => number;
    private changed;
    source(): InputTriggerSource;
    recordsFor(occurrences: readonly PasteOccurrence[]): PasteRecord[];
    private inputFor;
    private insertText;
    private insertRecords;
    /**
     * The host's verdict for one Session and selector label, when fresh. The
     * last CONFIRMED answer is authoritative while a background refresh is in
     * flight (the paste acts on what the host last said; the refresh only
     * covers the next paste). A label that changed since the confirmation
     * answers undefined, so the native attachment flow stays the default.
     * @param sessionId - the live Session the paste belongs to.
     * @param modelLabel - the model-selector label currently shown.
     * @returns the fresh confirmed verdict, or undefined when unconfirmed.
     */
    private verdictFor;
    /**
     * The exact model route the live model catalog reports for one Session.
     * Unreadable routes answer undefined, so the verdict falls back to the
     * selector label alone.
     * @param sessionId - the live Session id.
     * @returns the current provider/model selection, when readable.
     */
    private readSelection;
    /**
     * Ask the host what to do with a paste for the current model, and cache the
     * answer per Session and selector label. A model switch changes the label,
     * which changes the cache key, so a stale verdict never outlives the model
     * it described. The exact selection rides along when the live model catalog
     * is readable, so the host can answer with an auto-switch route; a 404
     * simply leaves the verdict unconfirmed; the next focus or paste retries.
     * @param sessionId - the live Session to ask about.
     * @param modelLabel - the model-selector label currently shown.
     */
    refreshVerdict(sessionId: string, modelLabel: string): void;
    /**
     * Switch one Session to the route the host validated, through the same
     * model-directory seat the selector uses when present (so the shared UI
     * state moves with the session), falling back to the raw RPC.
     * @param sessionId - the live Session id.
     * @param route - the validated variant route.
     */
    private switchModel;
    /**
     * Replay a swallowed paste as a synthetic clipboard event so the composer's
     * own intake (limits, thumbnails, keyboard) runs with the captured files.
     * @returns false when the environment cannot construct a clipboard payload.
     */
    private replayPaste;
    /**
     * Auto-switch flow: switch the Session to the image-input variant, announce
     * it, then replay the paste into the composer's native intake. A failed
     * switch, or an environment that cannot replay clipboard bytes, degrades to
     * the path takeover with the same files.
     * @param sessionId - the live Session id.
     * @param target - the composer textarea the paste landed on.
     * @param files - the captured image files.
     * @param text - same-paste text, replayed alongside the files.
     * @param route - the validated variant route to switch to.
     */
    private autoSwitchPaste;
    /**
     * Path-takeover flow: insert the same-paste text and every image as a text
     * reference that serializes to the image's workspace path on send.
     * @param sessionId - the live Session id.
     * @param target - the composer textarea the paste landed on.
     * @param files - the captured image files.
     * @param text - same-paste text.
     */
    private takeoverPaste;
    handlePaste(event: ClipboardEvent): boolean;
    remove(sessionId: string, occurrence: PasteOccurrence): void;
    private upload;
    private serialize;
}
/** Minimal per-image progress, failure, and removal feedback above the composer. */
export declare function PasteImageDock(props: PasteDockProps): ReactNode;
/** Install capture interception, the text-reference codec, and composer feedback. */
export declare function installPasteImages(ctx: ClientContext): void;
export {};
//# sourceMappingURL=paste-images.d.ts.map