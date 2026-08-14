/**
 * Pasted-image degradation helpers shared by the `prompt/image-fallback` and
 * `llm/request-content` waterfall listeners. Kept as pure functions (with the
 * filesystem writes injected) so the hook behavior is unit-testable without a
 * live harness.
 * @module dsh-vision-toolkit/degrade
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
/** Workspace-relative directory where pasted images land. */
export const PASTE_DIR = '.dsh-vision-toolkit/pastes';
/** Strip path separators so a hostile paste name cannot escape the paste dir. */
function safeName(raw) {
    const name = raw?.trim();
    if (name === undefined || name.length === 0)
        return undefined;
    const cleaned = basename(name).replace(/[^\w.\-]+/gu, '_');
    return cleaned.length === 0 ? undefined : cleaned;
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
export async function savePastedImages(content, workspace, options) {
    const saved = [];
    const blocks = [];
    for (const part of content) {
        blocks.push(part);
        if (part.type !== 'image')
            continue;
        const name = safeName(part.name) ?? `paste-${saved.length + 1}.png`;
        const relative = `${PASTE_DIR}/${options.stamp()}-${name}`;
        const absolute = join(workspace, relative);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, Buffer.from(part.data, 'base64'));
        saved.push({ path: relative, ...(part.name === undefined ? {} : { name: part.name }) });
    }
    if (saved.length > 0)
        blocks.push({ type: 'text', text: pastedImageNote(saved) });
    return { content: blocks, saved };
}
/** Model-visible note naming the saved pasted images and the tool to read them. */
export function pastedImageNote(saved) {
    const paths = saved.map(entry => entry.path).join(', ');
    return `[粘贴图片已保存到工作区: ${paths}] 需要查看图片内容时，使用视觉工具（如 vision_glance）读取该文件路径。`;
}
/** Whether any message in the assembled request carries an image block. */
export function messagesContainImage(messages) {
    return messages.some(message => message.content.some(block => block.type === 'image'));
}
/**
 * Drop image blocks from every message of an assembled model request. Only
 * used when the resolved target model cannot accept images; the path notes
 * written by {@link savePastedImages} stay in the messages.
 * @param messages - the assembled request messages.
 * @returns the stripped message list, or `undefined` when nothing changed.
 */
export function stripImageBlocks(messages) {
    let changed = false;
    const stripped = messages.map((message) => {
        if (!message.content.some(block => block.type === 'image'))
            return message;
        changed = true;
        return { ...message, content: message.content.filter(block => block.type !== 'image') };
    });
    return changed ? stripped : undefined;
}
//# sourceMappingURL=degrade.js.map