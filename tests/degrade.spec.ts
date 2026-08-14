import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  messagesContainImage,
  PASTE_DIR,
  pastedImageNote,
  savePastedImages,
  stripImageBlocks,
} from '../src/degrade.ts'
import type { Message } from '@deepseek-ai/dsh-llm'

const text = (value: string) => ({ type: 'text' as const, text: value })
const image = (data: string, name?: string) => ({
  type: 'image' as const,
  mediaType: 'image/png' as const,
  data,
  ...(name === undefined ? {} : { name }),
})

const STAMP = '2026-08-14T11-00-00-000Z'

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dvt-degrade-'))
}

describe('degrade helpers', () => {
  it('saves pasted images into the workspace and appends the path note', async () => {
    const workspace = await tempWorkspace()
    try {
      const { content, saved } = await savePastedImages(
        [text('what color?'), image('AQ==', 'shot.png'), text('thanks')],
        workspace,
        { stamp: () => STAMP },
      )
      expect(saved).toEqual([{ path: `${PASTE_DIR}/${STAMP}-shot.png`, name: 'shot.png' }])
      const written = await readFile(join(workspace, `${PASTE_DIR}/${STAMP}-shot.png`))
      expect([...written]).toEqual([1])
      expect(content).toEqual([
        { type: 'text', text: 'what color?' },
        image('AQ==', 'shot.png'),
        { type: 'text', text: 'thanks' },
        { type: 'text', text: pastedImageNote(saved) },
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('sanitizes hostile paste names and falls back to a numbered name', async () => {
    const workspace = await tempWorkspace()
    try {
      const { saved } = await savePastedImages(
        [image('AQ==', '../../evil.png'), image('Ag==')],
        workspace,
        { stamp: () => STAMP },
      )
      expect(saved.map(entry => entry.path)).toEqual([
        `${PASTE_DIR}/${STAMP}-evil.png`,
        `${PASTE_DIR}/${STAMP}-paste-2.png`,
      ])
      for (const entry of saved) {
        const written = await readFile(join(workspace, entry.path)).catch(() => undefined)
        expect(written).toBeDefined()
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('leaves text-only content untouched', async () => {
    const workspace = await tempWorkspace()
    try {
      const { content, saved } = await savePastedImages([text('plain')], workspace, { stamp: () => STAMP })
      expect(content).toEqual([{ type: 'text', text: 'plain' }])
      expect(saved).toEqual([])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('detects image blocks in assembled messages', () => {
    const message = (blocks: Array<{ type: string }>) => ({
      role: 'user',
      content: blocks,
      source: { kind: 'user' as const },
    })
    expect(messagesContainImage([message([{ type: 'text' }])])).toBe(false)
    expect(messagesContainImage([message([{ type: 'text' }, { type: 'image' }])])).toBe(true)
  })

  it('strips image blocks and keeps the path note, returning undefined when unchanged', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'what color?' }, { type: 'image', attachment: { attachmentId: 'a' } }],
        source: { kind: 'user' as const },
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '[粘贴图片已保存到工作区: .dsh-vision-toolkit/pastes/x.png]' }],
        source: { kind: 'user' as const },
      },
    ] as unknown as Message[]
    const stripped = stripImageBlocks(messages)
    expect(stripped).toBeDefined()
    expect(stripped![0]?.content).toEqual([{ type: 'text', text: 'what color?' }])
    expect(stripped![1]?.content).toEqual([{ type: 'text', text: '[粘贴图片已保存到工作区: .dsh-vision-toolkit/pastes/x.png]' }])
    expect(stripImageBlocks([messages[1]!])).toBeUndefined()
  })
})
