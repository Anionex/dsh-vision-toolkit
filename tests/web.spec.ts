import { createServer, type Server } from 'node:http'
import { Context } from 'cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import Settings, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ArtifactAccessController } from '../src/artifact-access.ts'
import { Config, VISION_TOOLKIT_SETTINGS_NAMESPACE, resolveConfig } from '../src/config.ts'
import type { VisionToolkitRuntime, VisionToolkitHealthResult } from '../src/runtime.ts'
import type { PreparedRuntimeGeneration, RuntimeManagerStatus } from '../src/runtime-manager.ts'
import { VisionToolkitWebBackend, type WebRuntimeManager } from '../src/web.ts'

const contexts: Context[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

class MemorySettings extends Settings {
  readonly writable = true
  private document: Record<string, unknown> = {}

  protected override load(): Promise<Record<string, unknown>> {
    return Promise.resolve(this.document)
  }

  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.document = { ...this.document, [ns]: section }
    return Promise.resolve()
  }
}

function credentials(): Credentials {
  return {
    resolve: vi.fn(async () => ({ value: 'never-exposed-secret', source: 'file' })),
    describe: vi.fn(async () => ({ configured: true, source: 'file', writable: true })),
  } as unknown as Credentials
}

function healthResult(testConnection: boolean): VisionToolkitHealthResult {
  const ok = { status: 'ok' as const, detail: 'fixture ok' }
  return {
    pluginVersion: '0.1.0',
    upstream: {
      repository: 'fixture', version: 'fixture', commit: 'fixture', path: '/fixture', source: 'managed',
      runtimeHome: '/fixture/runtime', python: 'python3', pythonVersion: '3.12.0', dependencies: {},
    },
    checks: {
      python: ok, dependencies: ok, chrome: ok, credential: ok,
      artifactDirectory: ok, tempDirectory: ok,
      service: testConnection ? ok : { status: 'not_tested', detail: 'not tested' },
    },
    healthy: true,
    connectionTested: testConnection,
  }
}

class FakeManager implements WebRuntimeManager {
  readonly healthCalls: boolean[] = []
  private active = resolveConfig({})
  private generation = 1
  readonly runtime = {
    upstreamVersion: {
      repository: 'fixture', version: 'fixture', commit: 'fixture', path: '/fixture', source: 'managed',
      runtimeHome: '/fixture/runtime', python: 'python3', pythonVersion: '3.12.0', dependencies: {},
    },
    health: async (testConnection: boolean) => {
      this.healthCalls.push(testConnection)
      return healthResult(testConnection)
    },
  } as unknown as VisionToolkitRuntime

  get ready(): boolean { return true }
  current(): VisionToolkitRuntime { return this.runtime }
  prepareCandidate(raw: Parameters<WebRuntimeManager['prepareCandidate']>[0]): Promise<PreparedRuntimeGeneration> {
    const config = resolveConfig(raw)
    return Promise.resolve({ config, fingerprint: JSON.stringify(config), runtime: this.runtime })
  }
  activateCandidate(candidate: PreparedRuntimeGeneration): void {
    this.active = candidate.config
    this.generation += 1
  }
  recordFailure(): void {}
  status(): RuntimeManagerStatus {
    return { ready: true, generation: this.generation, activeConfig: this.active, upstream: this.runtime.upstreamVersion }
  }
}

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemorySettings)
  ctx.provide('credentials', credentials())
  ctx.settings.register(VISION_TOOLKIT_SETTINGS_NAMESPACE, Config, {
    base: {}, applies: 'live', validate: (value) => { resolveConfig(value) },
  })
  const manager = new FakeManager()
  const artifacts = new ArtifactAccessController(Buffer.alloc(32, 7))
  const activated = vi.fn()
  const backend = new VisionToolkitWebBackend(ctx, manager, artifacts, activated)
  const server = createServer((req, res) => { void backend.handle(req, res) })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind')
  const base = `http://127.0.0.1:${address.port}`
  const post = (body: unknown) => fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify(body),
  })
  return { ctx, manager, activated, base, post }
}

describe('VisionToolkitWebBackend', () => {
  it('describes Settings and credential status without resolving or exposing the secret', async () => {
    const { ctx, base } = await setup()
    const response = await fetch(base)
    const body = await response.json() as { ok: true; value: { credential: { configured: boolean }; settings: { revision: number } } }

    expect(response.status).toBe(200)
    expect(body.value.credential.configured).toBe(true)
    expect(body.value.settings.revision).toBe(0)
    expect(JSON.stringify(body)).not.toContain('never-exposed-secret')
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
  })

  it('preflights, persists, activates, and rejects a stale revision', async () => {
    const { manager, activated, post } = await setup()
    const value = {
      provider: { baseUrl: 'https://vision.example/v1', credential: 'VISION_API_KEY', model: 'next-model' },
      language: 'en', timeoutMs: 45000, maxImageBytes: 1000000, maxImagePixels: 2000000,
      concurrency: 2, runtime: { mode: 'managed' }, allowedDirs: [],
    }
    const first = await post({ action: 'save', expectedRevision: 0, value })
    const firstBody = await first.json() as { ok: true; value: { settings: { revision: number } } }
    expect(first.status).toBe(200)
    expect(firstBody.value.settings.revision).toBe(1)
    expect(manager.status().activeConfig?.provider.model).toBe('next-model')
    expect(activated).toHaveBeenCalledTimes(1)

    const stale = await post({ action: 'save', expectedRevision: 0, value: { ...value, concurrency: 3 } })
    const staleBody = await stale.json() as { ok: false; error: { code: string } }
    expect(stale.status).toBe(409)
    expect(staleBody.error.code).toBe('settings-conflict')
    expect(manager.status().activeConfig?.concurrency).toBe(2)
  })

  it('runs no probe on reads and tests the connection only after the explicit action', async () => {
    const { manager, base, post } = await setup()
    await fetch(base)
    expect(manager.healthCalls).toEqual([])

    const local = await post({ action: 'health', testConnection: false })
    expect(local.status).toBe(200)
    const connection = await post({ action: 'health', testConnection: true })
    expect(connection.status).toBe(200)
    expect(manager.healthCalls).toEqual([false, true])
  })

  it('rejects cross-site and non-JSON writes before touching Settings', async () => {
    const { base } = await setup()
    const crossSite = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' }, body: '{}',
    })
    expect(crossSite.status).toBe(403)
    const plain = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: base }, body: '{}',
    })
    expect(plain.status).toBe(400)
  })
})
