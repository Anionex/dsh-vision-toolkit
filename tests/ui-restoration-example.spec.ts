import { accessSync, constants as fsConstants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { runUiRestorationExample } from '../scripts/ui-restoration-example.ts'

function hasChrome(): boolean {
  const fixed = process.platform === 'darwin'
    ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
    : []
  for (const path of fixed) {
    try {
      accessSync(path, fsConstants.X_OK)
      return true
    } catch {
      // Continue to PATH-based probes.
    }
  }
  const candidates = process.platform === 'win32'
    ? ['where chrome', 'where msedge']
    : ['command -v google-chrome', 'command -v google-chrome-stable', 'command -v chromium', 'command -v chromium-browser']
  return candidates.some(command => spawnSync(command, { shell: true, stdio: 'ignore' }).status === 0)
}

function hasPythonDependencies(): boolean {
  const candidates = process.platform === 'win32'
    ? [['py', '-3'], ['python'], ['python3']]
    : [['python3'], ['python']]
  return candidates.some(([program, ...prefix]) => spawnSync(program, [
    ...prefix,
    '-c',
    'import PIL,numpy',
  ], { stdio: 'ignore' }).status === 0)
}

describe.skipIf(!hasChrome() || !hasPythonDependencies())('UI restoration example', () => {
  it('replays HTML screenshots and proves the final pixel-diff threshold', async () => {
    const result = await runUiRestorationExample('check')
    expect(result.mode).toBe('check')
    expect(result.initialDifferencePct).toBeGreaterThanOrEqual(1)
    expect(result.finalDifferencePct).toBeLessThanOrEqual(0.02)
    expect(result.initialWorstRegions).toBeGreaterThan(0)
  }, 180_000)
})
