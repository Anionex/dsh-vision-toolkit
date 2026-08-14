/**
 * Pasted-image degradation helpers shared by the `prompt/image-fallback` and
 * `llm/request-content` waterfall listeners. Kept as pure functions (with the
 * filesystem writes injected) so the hook behavior is unit-testable without a
 * live harness.
 * @module dsh-vision-toolkit/degrade
 */
import type { PromptContentPart } from '@deepseek-ai/dsh-host-apiproxy';
import type { Message } from '@deepseek-ai/dsh-llm';
/** Workspace-relative directory where pasted images land. */
export declare const PASTE_DIR = ".dsh-vision-toolkit/pastes";
/** One pasted image persisted into the session workspace. */
export interface SavedPastedImage {
    /** Workspace-relative file path the model-visible tools can read. */
    path: string;
    /** Original filename when the paste carried one. */
    name?: string;
}
/**
 * Persist every image part of a prompt into the session workspace and return
 * the replacement content: text parts stay in place and each image part is
 * followed by a text block naming the saved file. The saved file is what the
 * model-visible visual tools (vision_glance & co.) read, so the degradation
 * stays transparent — the agent's tool calls are visible like any other tool
 * workflow. Image parts are kept so the session UI shows the paste; the
 * `llm/request-content` hook strips them from model requests.
 * @param content - browser-submitted prompt content.
 * @param workspace - the session workspace root (cwd).
 * @param options - `stamp` returns a per-paste unique token for filenames.
 * @returns the replacement content and the saved file records.
 * @throws when a file write fails; the caller refuses the prompt on error.
 */
export declare function savePastedImages(content: readonly PromptContentPart[], workspace: string, options: {
    stamp: () => string;
}): Promise<{
    content: PromptContentPart[];
    saved: SavedPastedImage[];
}>;
/** Model-visible note naming the saved pasted images and the tool to read them. */
export declare function pastedImageNote(saved: readonly SavedPastedImage[]): string;
/** Whether any message in the assembled request carries an image block. */
export declare function messagesContainImage(messages: readonly Message[]): boolean;
/**
 * Drop image blocks from every message of an assembled model request. Only
 * used when the resolved target model cannot accept images; the path notes
 * written by {@link savePastedImages} stay in the messages.
 * @param messages - the assembled request messages.
 * @returns the stripped message list, or `undefined` when nothing changed.
 */
export declare function stripImageBlocks(messages: readonly Message[]): Message[] | undefined;
//# sourceMappingURL=degrade.d.ts.map