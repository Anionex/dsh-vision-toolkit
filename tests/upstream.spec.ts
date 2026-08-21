import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findCheckout,
  parseCropOutput,
  parseDominantColorsOutput,
  parseExtractForegroundOutput,
  parseHtmlScreenshotOutput,
  parseLocationLine,
  parseLocationOutput,
  parsePixelDiffOutput,
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

  it('reassembles labels that the upstream CLI prints across multiple lines', () => {
    const elements = parseLocationOutput([
      '1. top-left navigation button x1: 1, y1: 2, x2: 30, y2: 40',
      '3. left 1 Massive Pretraining card | • 32T+ tokens',
      '---',
      '1. Fast setup',
      'x1: 50, y1: 60, x2: 300, y2: 400',
    ].join('\n'))
    expect(elements).toEqual([
      { label: 'navigation button', box: { x1: 1, y1: 2, x2: 30, y2: 40 } },
      {
        label: '1 Massive Pretraining card | • 32T+ tokens --- 1. Fast setup',
        box: { x1: 50, y1: 60, x2: 300, y2: 400 },
      },
    ])
  })

  it('uses the final coordinate suffix when visible label text contains coordinates', () => {
    expect(parseLocationOutput([
      '1. left code sample',
      'x1: 1, y1: 2, x2: 3, y2: 4',
      'continued output',
      'x1: 50, y1: 60, x2: 300, y2: 400',
    ].join('\n'))).toEqual([{
      label: 'code sample x1: 1, y1: 2, x2: 3, y2: 4 continued output',
      box: { x1: 50, y1: 60, x2: 300, y2: 400 },
    }])
  })

  it('returns an empty list for empty or no-elements output', () => {
    expect(parseLocationOutput('')).toEqual([])
    expect(parseLocationOutput('no elements detected')).toEqual([])
  })

  it('rejects non-empty lines outside the pinned coordinate contract', () => {
    expect(() => parseLocationOutput('model said the button is near the bottom')).toThrowError(/unrecognized lines/)
    expect(() => parseLocationOutput('1. top-left button without coordinates')).toThrowError(/unrecognized lines/)
    expect(() => parseLocationOutput([
      '1. top-left button without coordinates',
      '2. right input x1: 300, y1: 100, x2: 420, y2: 140',
    ].join('\n'))).toThrowError(/button without coordinates/)
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

describe('P1 upstream output parsers', () => {
  it('parses pixel-diff scaling, metrics, heatmap, and ranked boxes', () => {
    expect(parsePixelDiffOutput([
      'note: rebuilt was 320x180, scaled to 1280x720',
      'overall difference: 12.34%',
      'heatmap: /tmp/diff.png',
      '1. 23.45% x1: 0, y1: 0, x2: 640, y2: 360',
    ].join('\n'))).toEqual({
      scaled: true,
      rebuiltOriginalSize: { width: 320, height: 180 },
      scaledToSize: { width: 1280, height: 720 },
      overallDifferencePct: 12.34,
      heatmapPath: '/tmp/diff.png',
      worstRegions: [{ index: 1, differencePct: 23.45, box: { x1: 0, y1: 0, x2: 640, y2: 360 } }],
    })
  })

  it('parses foreground component metrics and written dimensions', () => {
    expect(parseExtractForegroundOutput([
      'auto: center=(128,128) disc radius≈77 exclude-color=#FFFFFF',
      'bbox (原图像素): x1: 10, y1: 20, x2: 42, y2: 44',
      '前景像素: 512  保留分量: 1/2  最大分量占比: 88%',
      'wrote /tmp/foreground.png (32x24)',
    ].join('\n'))).toMatchObject({
      box: { x1: 10, y1: 20, x2: 42, y2: 44 },
      foregroundPixels: 512,
      keptComponents: 1,
      totalComponents: 2,
      largestComponentPct: 88,
      outputPath: '/tmp/foreground.png',
      width: 32,
      height: 24,
    })
  })

  it('parses palette and candidate dominant-color modes with empty bars', () => {
    expect(parseDominantColorsOutput([
      'region 0,0,100,50 - 100x50 px',
      'top 2 of 4 clusters (merged at distance <= 8):',
      '#336699   42.1%  ####################',
      '#FFFFFF    1.5%',
    ].join('\n'))).toMatchObject({
      mode: 'palette',
      clusterCount: 4,
      colors: [{ color: '#336699', sharePct: 42.1 }, { color: '#FFFFFF', sharePct: 1.5 }],
    })
    expect(parseDominantColorsOutput([
      'region 0,0,100,50 - 100x50 px (5000 px sampled)',
      'candidate   share   mean_d  wt    bar',
      '*#336699    42.1%   4.0   100%  ####',
      ' #FFFFFF     0.0%  22.0     0%',
      'winner: #336699 (* in table) - wt is soft-match closeness, so the winner need not have the highest share; 42.1% of region pixels within distance <= 16',
    ].join('\n'))).toMatchObject({
      mode: 'candidates',
      sampledPixels: 5000,
      winner: '#336699',
      matchedWithinTolerance: true,
      candidates: expect.arrayContaining([
        expect.objectContaining({ color: '#FFFFFF', sharePct: 0, weightedScorePct: 0 }),
      ]),
    })
  })

  it('parses HTML screenshot summaries and rejects unknown P1 output', () => {
    expect(parseHtmlScreenshotOutput('wrote /tmp/page.png (1280x800)')).toEqual({
      outputPath: '/tmp/page.png',
      width: 1280,
      height: 800,
    })
    expect(parseHtmlScreenshotOutput('wrote /tmp/page.png (1280x4210; pageHeight=4210)')).toEqual({
      outputPath: '/tmp/page.png',
      width: 1280,
      height: 4210,
      pageHeight: 4210,
    })
    expect(() => parsePixelDiffOutput('overall difference: maybe')).toThrowError(/unexpected output/)
    expect(() => parseDominantColorsOutput('unknown')).toThrowError(/missing region header/)
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
