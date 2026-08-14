/** Clipboard-only multi-image input for DSH Web. */
import { type ReactNode } from 'react';
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { SlashSource } from '@deepseek-ai/dsh-client-ui-slash/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export declare const PASTE_IMAGES_ROUTE = "/_dsh/vision-toolkit/paste-images";
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
    constructor(ctx: ClientContext);
    subscribe: (listener: () => void) => (() => void);
    snapshot: () => number;
    private changed;
    source(): SlashSource;
    recordsFor(occurrences: readonly PasteOccurrence[]): PasteRecord[];
    private inputFor;
    private insertText;
    private insertRecords;
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