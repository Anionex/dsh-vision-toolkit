// @vitest-environment jsdom

import { createElement, type ComponentType } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, decodeVisionResult, inject } from '../src/client/index.tsx'

afterEach(() => { cleanup() })

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
})
