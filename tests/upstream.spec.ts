import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findCheckout,
  parseCropOutput,
  parseLocationLine,
  parseLocationOutput,
  parseTraceOutput,
} from '../src/upstream.ts'
import { bundledUpstreamRoot, verifyBundledUpstream } from '../src/runtime-install.ts'
import { VisionToolkitError } from '../src/errors.ts'
import { UPSTREAM_COMMIT, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from '../src/version.ts'

describe('findCheckout', () => {
  it('skips a config-like directory and picks the first real checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-vt-checkout-'))
    try {
      const bad = join(root, 'config-dir')
      const good = join(root, 'toolkit')
      await mkdir(join(good, 'bin'), { recursive: true })
      for (const tool of ['glance', 'ground', 'detect', 'crop', 'trace']) {
        await writeFile(join(good, 'bin', tool), '#!/usr/bin/env python3\n')
      }
      const resolved = await findCheckout([bad, good])
      expect(resolved).toBe(await realpath(good))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails loud when no candidate is a checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-vt-checkout-'))
    try {
      await expect(findCheckout([join(root, 'missing'), join(root, 'config')]))
        .rejects.toThrowError(/checkout not found/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('parseLocationLine', () => {
  it('parses the single-match coordinate line', () => {
    expect(parseLocationLine('x1: 1067, y1: 841, x2: 1108, y2: 881')).toEqual({
      box: { x1: 1067, y1: 841, x2: 1108, y2: 881 },
    })
  })

  it('parses numbered lines and strips the position word from the label', () => {
    expect(parseLocationLine('1. top-left send button x1: 100, y1: 50, x2: 200, y2: 90')).toEqual({
      label: 'send button',
      box: { x1: 100, y1: 50, x2: 200, y2: 90 },
    })
  })

  it('keeps a label without a position word intact', () => {
    expect(parseLocationLine('1. error message x1: 1, y1: 2, x2: 3, y2: 4')).toEqual({
      label: 'error message',
      box: { x1: 1, y1: 2, x2: 3, y2: 4 },
    })
  })

  it('returns undefined for unrelated lines', () => {
    expect(parseLocationLine('trace: warning: low fit')).toBeUndefined()
    expect(parseLocationLine('')).toBeUndefined()
  })
})

describe('parseLocationOutput', () => {
  it('parses a multi-match inventory', () => {
    const elements = parseLocationOutput([
      '1. top-left button x1: 10, y1: 20, x2: 60, y2: 40',
      '2. right input x1: 300, y1: 100, x2: 420, y2: 140',
    ].join('\n'))
    expect(elements).toHaveLength(2)
    expect(elements[0]).toMatchObject({ label: 'button', box: { x1: 10, y1: 20, x2: 60, y2: 40 } })
  })

  it('returns an empty list for empty or no-elements output', () => {
    expect(parseLocationOutput('')).toEqual([])
    expect(parseLocationOutput('no elements detected')).toEqual([])
  })

  it('rejects non-empty lines outside the pinned coordinate contract', () => {
    expect(() => parseLocationOutput('model said the button is near the bottom')).toThrowError(/unrecognized lines/)
  })
})

describe('parseCropOutput', () => {
  it('parses the wrote line and clamp note', () => {
    const parsed = parseCropOutput(
      'wrote /workspace/.dsh-vision-toolkit/a.crop.png (40x20)',
      'note: region 0,0,999,999 clamped to 0,0,64,64',
    )
    expect(parsed).toMatchObject({
      outputPath: '/workspace/.dsh-vision-toolkit/a.crop.png',
      width: 40,
      height: 20,
      clamped: true,
    })
    expect(parsed.note).toContain('clamped to')
  })

  it('rejects missing wrote lines', () => {
    expect(() => parseCropOutput('', '')).toThrowError(/did not report a written file/)
  })
})

describe('parseTraceOutput', () => {
  it('parses the pinned vtracer summary', () => {
    expect(parseTraceOutput('wrote /tmp/icon.svg (456 bytes, 3 paths, traced at 4x)')).toEqual({
      outputPath: '/tmp/icon.svg',
      bytes: 456,
      pathCount: 3,
      tracedScale: 4,
    })
  })

  it('rejects output outside the pinned summary contract', () => {
    expect(() => parseTraceOutput('wrote /tmp/icon.svg (456 bytes, 1 circle)')).toThrowError(/did not report/)
  })
})

describe('trace output failure classification', () => {
  it('throws VisionToolkitError with output code', () => {
    try {
      parseTraceOutput('not a trace summary')
      throw new Error('should not reach')
    } catch (error) {
      expect(error).toBeInstanceOf(VisionToolkitError)
      expect((error as VisionToolkitError).code).toBe('output')
    }
  })
})

describe('packaged upstream snapshot', () => {
  it('matches every committed file hash and the pinned identity', async () => {
    const manifest = await verifyBundledUpstream()
    expect(manifest).toMatchObject({
      repository: UPSTREAM_REPOSITORY,
      version: UPSTREAM_VERSION,
      commit: UPSTREAM_COMMIT,
    })
    expect(manifest.files.length).toBeGreaterThan(10)
    expect(bundledUpstreamRoot()).toMatch(/vendor[/\\]agent-vision-toolkit$/)
  })
})
