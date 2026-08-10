import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa, execaSync } from 'execa'
import { startMockLlmServer } from '../../packages/support/llm-mock-server/src/index.ts'
import { afterEach, describe, expect, it } from 'vitest'

/** Keyless real-profile acceptance: clean DSH_HOME install → boot → tool call → uninstall. */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const pluginDir = join(repoRoot, 'dsh-vision-toolkit')
const SAMPLE_IMAGE = 'dsh-vision-toolkit/tests/fixtures/sample.png'

function hasPnpm(): boolean {
  try {
    execaSync('pnpm', ['--version'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

function hasDsh(): boolean {
  try {
    execaSync('dsh', ['--version'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

async function runDsh(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  cwd = repoRoot,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const childEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env })
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const result = await execa('dsh', args, {
    input: '',
    timeout: 120_000,
    killSignal: 'SIGKILL',
    reject: false,
    env: childEnv,
    extendEnv: false,
    cwd,
  })
  if (result.timedOut) {
    throw new Error(`dsh did not exit within 120s. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return { stdout: result.stdout, stderr: result.stderr, code: result.exitCode ?? -1 }
}

async function startMockVisionServer() {
  const requests: Array<{ authorization: string | undefined; body: unknown }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end('{"error":"invalid JSON"}')
        return
      }
      requests.push({ authorization: request.headers.authorization, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: 'Fixture detailed description' } }] }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
      server.closeAllConnections()
    }),
  }
}

function fixturePatch(home: string, visionBaseUrl: string): string {
  const path = join(home, 'fixture-patch.yml')
  writeFileSync(path, [
    '- id: vision-toolkit',
    '  config:',
    '    provider:',
    `      baseUrl: ${visionBaseUrl}`,
    '      credential: VISION_API_KEY',
    '      model: fixture-model',
    '    language: en',
    '    timeoutMs: 60000',
    '    maxImageBytes: 10485760',
    '    maxImagePixels: 40000000',
    '    concurrency: 4',
    '    runtime:',
    '      mode: managed',
    '    allowedDirs: []',
    '- id: session-title-llm',
    '  disabled: true',
    '',
  ].join('\n'))
  return path
}

describe.skipIf(!hasDsh() || !hasPnpm())('dsh-vision-toolkit profile install (keyless e2e)', () => {
  const homes: string[] = []

  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  })

  it('installs, boots, calls vision_glance through the real profile, and uninstalls cleanly', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-vt-profile-'))
    homes.push(home)
    const visionServer = await startMockVisionServer()
    const patch = fixturePatch(home, visionServer.baseURL)

    try {
      const add = await runDsh(['plugin', '--profile', 'headless', 'add', pluginDir], { DSH_HOME: home })
      expect(add.code, add.stderr).toBe(0)

      const dump = await runDsh(['--profile', 'headless', '--dump-config'], { DSH_HOME: home })
      expect(dump.stdout).toContain('- id: vision-toolkit')
      expect(dump.stdout).toContain("name: '@dsh-external/dsh-vision-toolkit'")

      const server = await startMockLlmServer({
        sequence: ['tool_call_success', 'success'],
        toolName: 'vision_glance',
        toolArguments: JSON.stringify({ images: [SAMPLE_IMAGE] }),
        successText: 'vision done',
      })
      try {
        const run = await runDsh([
          'run', '--profile', 'headless', '--patch', patch,
          'use the vision tool on the sample image',
        ], {
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: 'mock-vision-e2e-key',
          DEEPSEEK_BASE_URL: server.baseURL,
          VISION_API_KEY: 'fixture-vision-key',
        })
        expect(run.code, run.stderr).toBe(0)
        expect(run.stdout).toBe('vision done')
        const bodies = JSON.stringify(server.requests.map(request => request.body))
        expect(bodies).toContain('vision_glance')
        expect(bodies).toContain('Fixture detailed description')
        expect(visionServer.requests).toHaveLength(1)
        expect(visionServer.requests[0]?.authorization).toBe('Bearer fixture-vision-key')
        expect(JSON.stringify(visionServer.requests[0]?.body)).toContain('data:image/png;base64,')
      } finally {
        await server.close()
      }

      const disablePatch = join(home, 'disable.yml')
      writeFileSync(disablePatch, [
        '- id: vision-toolkit',
        '  disabled: true',
        '',
      ].join('\n'))
      const disabledServer = await startMockLlmServer({
        sequence: ['success'],
        repeatLast: true,
        successText: 'disabled ok',
      })
      try {
        const disabled = await runDsh([
          'run', '--profile', 'headless', '--patch', patch, '--patch', disablePatch,
          'say ok',
        ], {
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: 'mock-vision-e2e-key',
          DEEPSEEK_BASE_URL: disabledServer.baseURL,
          VISION_API_KEY: 'fixture-vision-key',
        })
        expect(disabled.code, disabled.stderr).toBe(0)
        expect(disabled.stdout).toBe('disabled ok')
        const disabledBodies = JSON.stringify(disabledServer.requests.map(request => request.body))
        expect(disabledBodies).not.toContain('vision_glance')
      } finally {
        await disabledServer.close()
      }

      const remove = await runDsh(['plugin', '--profile', 'headless', 'remove', '@dsh-external/dsh-vision-toolkit'], {
        DSH_HOME: home,
      })
      expect(remove.code, remove.stderr).toBe(0)
      const dumpAfter = await runDsh(['--profile', 'headless', '--dump-config'], { DSH_HOME: home })
      expect(dumpAfter.stdout).not.toContain('vision-toolkit')
    } finally {
      await visionServer.close()
    }
  }, 300_000)
})
