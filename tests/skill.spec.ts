import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  VISION_SKILLS_CONTENT,
  VISION_SKILLS_RESOURCE_BASE,
  VISION_SKILLS_SKILL,
} from '../src/skill.ts'

const REFERENCES = [
  'gui.md',
  'long-screenshot-ocr.md',
  'restore-graphic.md',
  'restore-structure.md',
  'restore-ui.md',
]

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

describe('adapted upstream vision-tools Skill renamed to vision-skills', () => {
  it('loads the packaged Markdown and exposes its reference base', async () => {
    const bytes = await readFile(join(VISION_SKILLS_RESOURCE_BASE, 'SKILL.md'))
    expect(VISION_SKILLS_CONTENT).toBe(bytes.toString('utf8'))
    expect(VISION_SKILLS_SKILL.name).toBe('vision-skills')
    expect(VISION_SKILLS_SKILL.resourceBase).toEqual({
      kind: 'directory',
      path: VISION_SKILLS_RESOURCE_BASE,
    })
    for (const reference of REFERENCES) {
      await expect(stat(join(VISION_SKILLS_RESOURCE_BASE, 'references', reference))).resolves.toBeDefined()
      expect(VISION_SKILLS_CONTENT).toContain(`references/${reference}`)
    }
  })

  it('records exact upstream and adapted file hashes', async () => {
    const manifest = JSON.parse(await readFile(join(VISION_SKILLS_RESOURCE_BASE, 'UPSTREAM.json'), 'utf8')) as {
      commit: string
      sourceFiles: Array<{ path: string; sha256: string }>
      adaptedFiles: Array<{ path: string; sha256: string }>
    }
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/u)
    expect(manifest.sourceFiles.map(file => file.path)).toEqual([
      'SKILL.md',
      ...REFERENCES.map(reference => `references/${reference}`),
    ])
    for (const file of manifest.adaptedFiles) {
      const bytes = await readFile(join(VISION_SKILLS_RESOURCE_BASE, ...file.path.split('/')))
      expect(file.sha256, file.path).toBe(sha256(bytes))
    }
  })

  it('uses native DSH calls without retaining upstream CLI invocation syntax', async () => {
    const bodies = await Promise.all([
      Promise.resolve(VISION_SKILLS_CONTENT),
      ...REFERENCES.map(reference => readFile(join(VISION_SKILLS_RESOURCE_BASE, 'references', reference), 'utf8')),
    ])
    const combined = bodies.join('\n')
    expect(combined).toContain('vision_glance')
    expect(combined).toContain('vision_html_screenshot')
    expect(combined).not.toContain('```bash')
    expect(combined).not.toMatch(/python3\s+(?:scripts\/)?(?:long_screenshot_ocr|extract_fg|html_shot|pixel_diff|dominant_colors)\.py/u)
    expect(combined).not.toMatch(/(?:^|\s)(?:glance|ground|detect|trace|crop)\s+<[^>]+>/mu)
  })
})
