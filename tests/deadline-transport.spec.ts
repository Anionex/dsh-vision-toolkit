import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import { expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { VisionToolkitRuntime } from '../src/runtime.ts'
import { UpstreamAdapter } from '../src/upstream.ts'

it('bounds delayed attempts while allowing fast retries through the vendored CLI', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'vision-deadline-'))
  await copyFile(fileURLToPath(new URL('./fixtures/sample.png', import.meta.url)), join(workspace, 'sample.png'))
  let mode: 'delay' | 'retry' = 'delay'
  const requests: Record<string, unknown>[] = []
  const timers: ReturnType<typeof setTimeout>[] = []
  let closedBeforeResponse = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString()))
      response.on('close', () => { if (!response.writableEnded) closedBeforeResponse += 1 })
      if (mode === 'retry' && requests.length === 1) {
        response.writeHead(429, { 'Retry-After': '0' })
        response.end('{}')
      } else {
        timers.push(setTimeout(() => {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ choices: [{ message: { content: 'delayed fixture' } }] }))
        }, mode === 'delay' ? 4500 : 0))
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no TCP address')
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessService)
  ctx.provide('credentials', { async resolve() { return { value: 'fixture-key', source: 'env' } } } as unknown as Credentials)
  const config = resolveConfig({ provider: { baseUrl: `http://127.0.0.1:${address.port}/v1`, credential: 'K', model: 'fixture' } })
  const adapter = new UpstreamAdapter(ctx, config, {
    source: 'managed', root: fileURLToPath(new URL('../vendor/agent-vision-toolkit', import.meta.url)),
    python: { program: 'python3', prefix: [], display: 'python3' }, cleanHome: workspace,
    pythonVersion: '3.11+', dependencies: {},
  })
  const runtime = new VisionToolkitRuntime(ctx, config, adapter)
  const warning = vi.spyOn(ctx.logger, 'warn')
  const signal = new AbortController().signal
  try {
    await expect(runtime.glance({ images: ['sample.png'] }, { signal, workspace, timeoutMs: 3000 }))
      .rejects.toMatchObject({ code: 'timeout' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).not.toHaveProperty('max_tokens')
    await vi.waitFor(() => expect(closedBeforeResponse).toBe(1))
    const diagnostic = warning.mock.calls.find(call => String(call[0]).startsWith('dsh-vision-toolkit tool='))
    expect(diagnostic?.[5]).toBeGreaterThan(0)
    await expect(runtime.glance({ images: ['sample.png'] }, { signal, workspace, timeoutMs: 10000 }))
      .resolves.toMatchObject({ answer: 'delayed fixture' })
    mode = 'retry'
    requests.length = 0
    await expect(runtime.glance({ images: ['sample.png'] }, { signal, workspace }))
      .resolves.toMatchObject({ answer: 'delayed fixture' })
    expect(requests).toHaveLength(2)
  } finally {
    timers.forEach(clearTimeout)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await ctx.fiber.dispose()
    await rm(workspace, { recursive: true, force: true })
  }
}, 30000)
