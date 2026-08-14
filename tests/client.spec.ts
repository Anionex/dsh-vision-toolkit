// @vitest-environment jsdom

import { createElement, type ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, decodeVisionResult, inject, VisionSettingsController } from '../src/client/index.tsx'

afterEach(() => {
  cleanup()
  document.querySelectorAll('style[data-plugin-css="@anionex/dsh-vision-toolkit/client"]').forEach(element => { element.remove() })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function settled(meta: unknown, isError = false, toolName = 'vision_ground'): ToolCallBlock {
  return {
    kind: 'tool-result',
    seq: 2,
    time: Date.now(),
    callId: 'call-1',
    call: { name: toolName, argsRaw: '{}' },
    callTime: Date.now() - 10,
    content: [{ type: 'text', text: JSON.stringify(meta) }],
    isError,
    meta,
    callView: null,
    resultView: null,
    subCalls: [],
  } as unknown as ToolCallBlock
}

function fakeClientContext(legacyRemote = true) {
  const registrations: Array<{ options: Record<string, unknown>; component: ComponentType<Record<string, unknown>> }> = []
  const effects: Array<() => void> = []
  const slots = {
    inject: vi.fn((_name: string, callback: () => unknown) => {
      const result = callback()
      if (result !== null && typeof result === 'object' && Symbol.iterator in result) {
        for (const dispose of result as Iterable<() => void>) effects.push(dispose)
      } else if (typeof result === 'function') {
        effects.push(result as () => void)
      }
    }),
    register: vi.fn((options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>) => {
      registrations.push({ options, component })
      return () => {}
    }),
  }
  const ctx = {
    slots,
    inputTriggers: { registerSource: vi.fn(() => () => {}) },
    sessions: {
      list: { getSnapshot: () => ({ current: undefined }) },
      scope: vi.fn(() => undefined),
    },
    conversation: { input: { for: vi.fn() } },
    locale: {
      register: vi.fn(() => () => {}),
      bind: vi.fn(() => (key: string) => key),
    },
    remote: legacyRemote ? { $on: vi.fn(() => () => {}) } : {},
    effect: vi.fn((setup: () => void | (() => void)) => {
      const dispose = setup()
      if (typeof dispose === 'function') effects.push(dispose)
    }),
    on: vi.fn(() => () => {}),
    inject: vi.fn((services: string[], callback: (scope: unknown) => void) => {
      if (services.every(service => service in ctx)) callback(ctx)
    }),
  }
  return { ctx, slots, registrations, effects }
}

function settingsSnapshot(runtime: { ready: boolean; lastError?: string } = { ready: true }) {
  return {
    schemaVersion: 1,
    writable: true,
    settings: {
      value: {
        provider: { baseUrl: 'https://api.inferera.com/v1', credential: 'VISION_API_KEY', model: 'gemini-3.6-flash' },
        language: 'zh',
        timeoutMs: 61000,
        maxImageBytes: 10485760,
        maxImagePixels: 40000000,
        concurrency: 4,
        runtime: { mode: 'managed' },
        allowedDirs: [],
      },
      revision: 1,
      applies: 'live',
    },
    credential: { ref: 'VISION_API_KEY', configured: false, writable: true },
    runtime: {
      ...runtime,
      generation: 1,
      upstream: {
        source: 'managed',
        path: '/runtime/agent-vision-toolkit',
        runtimeHome: '/runtime/home',
        python: '/runtime/python',
        pythonVersion: '3.12.0',
      },
    },
    release: {
      pluginVersion: '0.1.0',
      upstreamRepository: 'https://github.com/Anionex/agent-vision-toolkit',
      upstreamVersion: 'v0.1.0+snapshot.c27d1a3',
      upstreamCommit: 'c27d1a300962b553c0884993c575cd3e819465ce',
    },
    artifactRouteAvailable: true,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function artifact(
  path: string,
  filename: string,
  mimeType: string,
  kind: 'image' | 'svg' | 'json',
  description: string,
  previewIntent: 'image' | 'svg' | 'download',
) {
  return {
    path,
    filename,
    mimeType,
    kind,
    description,
    sourceTool: 'vision_card_test',
    previewIntent,
    bytes: 123,
  }
}

describe('Vision Toolkit client plugin', () => {
  it('registers every dedicated Tool view and the Settings section', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'conversation', 'sessions'])
    const { ctx, registrations } = fakeClientContext()
    apply(ctx as never)
    const remote = ctx.remote as { $on: ReturnType<typeof vi.fn> }
    expect(remote.$on).toHaveBeenCalledWith('settings/document-updated', expect.any(Function))
    expect(remote.$on).toHaveBeenCalledWith('credentials/updated', expect.any(Function))

    const toolKeys = registrations
      .filter(entry => entry.options.name === 'tool.call.toolview')
      .map(entry => entry.options.key)
    expect(toolKeys).toEqual([
      'vision_ground',
      'vision_detect',
      'vision_trace',
      'vision_pixel_diff',
      'vision_crop',
      'vision_long_screenshot_ocr',
      'vision_extract_foreground',
      'vision_html_screenshot',
      'vision_dominant_colors',
    ])
    expect(registrations.find(entry => entry.options.name === 'settings.section')?.options).toMatchObject({
      id: 'vision-toolkit', order: 30,
    })
  })

  it('uses current client runtime invalidation events when remote.$on is unavailable', () => {
    const { ctx } = fakeClientContext(false)
    apply(ctx as never)
    expect(ctx.on).toHaveBeenCalledWith('settings/changed', expect.any(Function))
    expect(ctx.on).toHaveBeenCalledWith('credentials/changed', expect.any(Function))
    expect(ctx.on).toHaveBeenCalledWith('connection/reset', expect.any(Function))
  })

  it('uses Harness theme tokens for every theme-dependent color', () => {
    const { ctx } = fakeClientContext()
    apply(ctx as never)

    const styles = document.querySelector<HTMLStyleElement>('style[data-plugin-css="@anionex/dsh-vision-toolkit/client"]')
    const css = styles?.textContent ?? ''
    expect(css).toContain('.dvt-preview{display:block;width:100%;max-height:360px;object-fit:contain;background:repeating-conic-gradient(var(--dsw-alias-bg-module-platform) 0 25%,var(--dsw-alias-bg-layer-1) 0 50%)')
    expect(css).toContain('.dvt-download{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:999px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)')
    expect(css).toContain('.dvt-download:hover{background:var(--dsw-alias-button-primary-hover)}')
    expect(css).toContain('.dvt-alert.warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}')
    expect(css).toContain('.dvt-health-grid>div[data-status=error]{border-left-color:var(--dsw-alias-state-error-primary)}')
    expect(css).not.toMatch(/--dsw-alias-(?:fg-primary|fg-muted|border-subtle)/u)
    expect(css).not.toMatch(/var\(--dsw-[^,)]+,/u)
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/iu)
  })

  it('prefers canonical presentation metadata and falls back to JSON result text', () => {
    const canonical = { target: 'Send', matches: [] }
    expect(decodeVisionResult(settled(canonical))).toBe(canonical)
    const noMeta = { ...settled(undefined), content: [{ type: 'text', text: '{}' }] } as unknown as ToolCallBlock
    expect(decodeVisionResult(noMeta)).toEqual({})
    expect(decodeVisionResult(settled(canonical, true))).toBeUndefined()
  })

  it('renders the Ground coordinates and capability-backed preview', () => {
    const { ctx, registrations } = fakeClientContext()
    apply(ctx as never)
    const ground = registrations.find(entry => entry.options.key === 'vision_ground')
    if (ground === undefined) throw new Error('Ground component was not registered')
    const artifact = {
      path: '/workspace/.dsh-vision-toolkit/artifacts/ground.png',
      filename: 'ground.png',
      mimeType: 'image/png',
      kind: 'image',
      description: 'Ground preview',
      sourceTool: 'vision_ground',
      previewIntent: 'image',
      bytes: 123,
    }
    const block = settled({
      target: 'Send', imageWidth: 1280, imageHeight: 720,
      matches: [{ label: 'Send', box: { x1: 924, y1: 645, x2: 952, y2: 670 } }],
      preview: artifact,
      $dshVisionToolkit: {
        schemaVersion: 1,
        artifacts: [{ path: artifact.path, previewUrl: '/preview-token', downloadUrl: '/download-token' }],
      },
    })
    const openFile = vi.fn()
    render(createElement(ground.component, {
      callId: 'call-1', toolName: 'vision_ground', block, openFile,
      t: (key: string) => key,
    }))

    expect(screen.getByText('924, 645, 952, 670')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Ground preview' }).getAttribute('src')).toBe('/preview-token')
    expect(screen.getByRole('link', { name: 'download' }).getAttribute('href')).toBe('/download-token')
  })

  it('renders Detect, Trace, and Pixel Diff contracts with safe previews and actions', () => {
    const { ctx, registrations } = fakeClientContext()
    apply(ctx as never)
    const component = (key: string) => {
      const found = registrations.find(entry => entry.options.key === key)
      if (found === undefined) throw new Error(`${key} component was not registered`)
      return found.component
    }
    const props = (toolName: string, meta: unknown) => ({
      callId: `call-${toolName}`,
      toolName,
      block: settled(meta, false, toolName),
      openFile: vi.fn(),
      t: (key: string) => key,
    })

    const detectPreview = artifact('/workspace/detect.png', 'detect.png', 'image/png', 'image', 'Detection preview', 'image')
    const detect = render(createElement(component('vision_detect'), props('vision_detect', {
      imageWidth: 900,
      imageHeight: 430,
      elements: [
        { index: 1, label: 'Header', box: { x1: 68, y1: 72, x2: 758, y2: 148 } },
        { index: 2, label: 'Primary button', box: { x1: 448, y1: 266, x2: 758, y2: 334 } },
      ],
      preview: detectPreview,
      $dshVisionToolkit: {
        schemaVersion: 1,
        artifacts: [{ path: detectPreview.path, previewUrl: '/detect-preview', downloadUrl: '/detect-download' }],
      },
    })))
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('Primary button')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Detection preview' }).getAttribute('src')).toBe('/detect-preview')
    detect.unmount()

    const traceArtifact = artifact('/workspace/trace.svg', 'trace.svg', 'image/svg+xml', 'svg', 'Recovered vector', 'svg')
    const trace = render(createElement(component('vision_trace'), props('vision_trace', {
      artifact: traceArtifact,
      geometry: { pathCount: 17, bytes: 18642 },
      $dshVisionToolkit: {
        schemaVersion: 1,
        artifacts: [{ path: traceArtifact.path, previewUrl: '/trace-preview', downloadUrl: '/trace-download' }],
      },
    })))
    expect(screen.getByText('17 paths · 18.2 KB')).toBeTruthy()
    expect(screen.getByTitle('Recovered vector').getAttribute('sandbox')).toBe('')
    expect(screen.getByRole('link', { name: 'download' }).getAttribute('href')).toBe('/trace-download')
    trace.unmount()

    const heatmap = artifact('/workspace/heatmap.png', 'heatmap.png', 'image/png', 'image', 'Difference heatmap', 'image')
    const report = artifact('/workspace/report.json', 'report.json', 'application/json', 'json', 'Difference report', 'download')
    render(createElement(component('vision_pixel_diff'), props('vision_pixel_diff', {
      overallDifferencePct: 6.0438,
      worstRegions: [
        { differencePct: 12.413, box: { x1: 72, y1: 126, x2: 322, y2: 276 } },
      ],
      heatmap,
      report,
      $dshVisionToolkit: {
        schemaVersion: 1,
        artifacts: [
          { path: heatmap.path, previewUrl: '/heatmap-preview', downloadUrl: '/heatmap-download' },
          { path: report.path, previewUrl: '/report-preview', downloadUrl: '/report-download' },
        ],
      },
    })))
    expect(screen.getByText('6.0438%')).toBeTruthy()
    expect(screen.getByText('72, 126, 322, 276')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Difference heatmap' }).getAttribute('src')).toBe('/heatmap-preview')
    expect(screen.getByText('report.json')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'download' })).toHaveLength(2)
  })

  it('reloads the authoritative same-revision settings after a runtime candidate is rejected', async () => {
    const initial = settingsSnapshot()
    const rejected = settingsSnapshot({
      ready: true,
      lastError: 'agent-vision-toolkit path does not exist: /nonexistent/dsh-vision-toolkit',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, value: initial }))
      .mockResolvedValueOnce(jsonResponse({
        ok: false,
        error: { code: 'INVALID_CONFIG', message: 'agent-vision-toolkit path does not exist' },
      }, 400))
      .mockResolvedValueOnce(jsonResponse({ ok: true, value: rejected }))
    vi.stubGlobal('fetch', fetchMock)

    const { ctx, registrations } = fakeClientContext()
    apply(ctx as never)
    const settings = registrations.find(entry => entry.options.name === 'settings.section')
    if (settings === undefined) throw new Error('Settings component was not registered')
    render(createElement(settings.component, {
      controller: new VisionSettingsController(),
      t: (key: string) => key,
    }))

    const runtimeMode = await screen.findByLabelText('runtimeMode')
    fireEvent.change(runtimeMode, { target: { value: 'external' } })
    const toolkitPath = await screen.findByLabelText('toolkitPath')
    fireEvent.change(toolkitPath, { target: { value: '/nonexistent/dsh-vision-toolkit' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await screen.findByText('agent-vision-toolkit path does not exist')

    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    await waitFor(() => {
      expect((screen.getByLabelText('runtimeMode') as HTMLSelectElement).value).toBe('managed')
    })
    expect(screen.queryByLabelText('toolkitPath')).toBeNull()
    expect(screen.getByText('runtimeCandidateRejected')).toBeTruthy()
    expect(screen.queryByText('runtimeUnavailable')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
