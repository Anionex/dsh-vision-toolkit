// @vitest-environment jsdom

import { createElement, type ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, decodeVisionResult, inject, VisionSettingsController } from '../src/client/index.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function settled(meta: unknown, isError = false): ToolCallBlock {
  return {
    kind: 'tool-result',
    seq: 2,
    time: Date.now(),
    callId: 'call-1',
    call: { name: 'vision_ground', argsRaw: '{}' },
    callTime: Date.now() - 10,
    content: [{ type: 'text', text: JSON.stringify(meta) }],
    isError,
    meta,
    callView: null,
    resultView: null,
    subCalls: [],
  } as unknown as ToolCallBlock
}

function fakeClientContext() {
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
    locale: {
      register: vi.fn(() => () => {}),
      bind: vi.fn(() => (key: string) => key),
    },
    effect: vi.fn((setup: () => void | (() => void)) => {
      const dispose = setup()
      if (typeof dispose === 'function') effects.push(dispose)
    }),
    on: vi.fn(() => () => {}),
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

describe('Vision Toolkit client plugin', () => {
  it('registers every dedicated Tool view and the Settings section', () => {
    expect(inject).toEqual(['slots', 'locale'])
    const { ctx, registrations } = fakeClientContext()
    apply(ctx as never)

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
      'vision_toolkit_health',
    ])
    expect(registrations.find(entry => entry.options.name === 'settings.section')?.options).toMatchObject({
      id: 'vision-toolkit', order: 30,
    })
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
