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
     * Whether to take a paste over for one Session and selector label, from the
     * host's cached verdict. Unconfirmed or stale answers false, so the native
     * attachment flow is the default; the host refreshes in the background.
     * @param sessionId - the live Session the paste belongs to.
     * @param modelLabel - the model-selector label currently shown.
     * @returns true only for a fresh confirmed text-only verdict.
     */
    private verdictFor;
    /**
     * Ask the host whether the current model is text-only, and cache the answer
     * per Session and selector label. A model switch changes the label, which
     * changes the cache key, so a stale verdict never outlives the model it
     * described. A 404 simply leaves the verdict unconfirmed; the next focus or
     * paste retries.
     * @param sessionId - the live Session to ask about.
     * @param modelLabel - the model-selector label currently shown.
     */
    refreshVerdict(sessionId: string, modelLabel: string): void;
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