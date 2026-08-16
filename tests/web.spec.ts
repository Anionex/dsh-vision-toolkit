import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Credentials } from '@deepseek-ai/dsh-credentials'
import Settings, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ArtifactAccessController } from '../src/artifact-access.ts'
import { Config, VISION_TOOLKIT_SETTINGS_NAMESPACE, resolveConfig } from '../src/config.ts'
import type { VisionToolkitRuntime, VisionToolkitHealthResult } from '../src/runtime.ts'
import type { PreparedRuntimeGeneration, RuntimeManagerStatus } from '../src/runtime-manager.ts'
import {
  VisionToolkitWebBackend,
  createPastePolicyHandler,
  type WebPluginUpdater,
  type WebRuntimeManager,
} from '../src/web.ts'

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
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {}),
  } as unknown as Credentials
}

function healthResult(testConnection: boolean, testModel = false): VisionToolkitHealthResult {
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
      model: testModel ? ok : { status: 'not_tested', detail: 'not tested' },
    },
    healthy: true,
    connectionTested: testConnection,
    modelTested: testModel,
  }
}

class FakeManager implements WebRuntimeManager {
  readonly healthCalls: Array<{ testConnection: boolean; testModel: boolean; workspace: string }> = []
  private active = resolveConfig({})
  private generation = 1
  readonly runtime = {
    upstreamVersion: {
      repository: 'fixture', version: 'fixture', commit: 'fixture', path: '/fixture', source: 'managed',
      runtimeHome: '/fixture/runtime', python: 'python3', pythonVersion: '3.12.0', dependencies: {},
    },
    health: async (testConnection: boolean, options: { workspace: string }, testModel = false) => {
      this.healthCalls.push({ testConnection, testModel, workspace: options.workspace })
      return healthResult(testConnection, testModel)
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

class FakeUpdater implements WebPluginUpdater {
  readonly checks = vi.fn(async () => ({
    supported: true,
    profile: 'web',
    dependencySpec: '0.1.0',
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
    updateAvailable: true,
    checkedAt: '2026-08-16T12:00:00.000Z',
  }))
  readonly installs = vi.fn(async (expectedVersion: string) => ({
    fromVersion: '0.1.0',
    toVersion: expectedVersion,
    profile: 'web',
    restarting: true as const,
    retryAfterMs: 1200,
  }))

  capability() {
    return Promise.resolve({ supported: true, profile: 'web', dependencySpec: '0.1.0' })
  }

  check() {
    return this.checks()
  }

  installAndRestart(expectedVersion: string) {
    return this.installs(expectedVersion)
  }
}

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemorySettings)
  const credentialService = credentials()
  ctx.provide('credentials', credentialService)
  ctx.settings.register(VISION_TOOLKIT_SETTINGS_NAMESPACE, Config, {
    base: {}, applies: 'live', validate: (value) => { resolveConfig(value) },
  })
  const manager = new FakeManager()
  const artifacts = new ArtifactAccessController(Buffer.alloc(32, 7))
  const activated = vi.fn()
  const updater = new FakeUpdater()
  const backend = new VisionToolkitWebBackend(ctx, manager, artifacts, activated, updater)
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
  return { ctx, credentialService, manager, activated, updater, base, post }
}

describe('VisionToolkitWebBackend', () => {
  it('describes Settings and credential status without resolving or exposing the secret', async () => {
    const { ctx, base, credentialService } = await setup()
    const response = await fetch(base)
    const body = await response.json() as {
      ok: true
      value: {
        credential: { configured: boolean; ref: string; source?: string; writable: boolean }
        settings: { revision: number }
      }
    }

    expect(response.status).toBe(200)
    expect(body.value.credential.configured).toBe(true)
    expect(body.value.credential.ref).toBe('ANIONEX_FREE_VISION')
    expect(body.value.credential.source).toBe('built-in-free')
    expect(body.value.credential.writable).toBe(false)
    expect(body.value.settings.revision).toBe(0)
    expect(JSON.stringify(body)).not.toContain('never-exposed-secret')
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
    expect(credentialService.describe).not.toHaveBeenCalled()
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

  it('stores a write-only API key only after the saved credential reference is current', async () => {
    const { credentialService, post } = await setup()
    const value = {
      provider: {
        baseUrl: 'https://vision.example/v1', credential: 'VISION_API_KEY', model: 'next-model',
        protocol: 'openai' as const,
      },
      language: 'en' as const, timeoutMs: 45000, maxImageBytes: 1000000, maxImagePixels: 2000000,
      concurrency: 2, runtime: { mode: 'managed' as const }, allowedDirs: [],
    }
    const saved = await post({ action: 'save', expectedRevision: 0, value })
    const savedBody = await saved.json() as { ok: true; value: { settings: { revision: number }; credential: { ref: string } } }

    const stored = await post({
      action: 'credential',
      expectedRevision: savedBody.value.settings.revision,
      ref: savedBody.value.credential.ref,
      value: '  sk-browser-entry  ',
    })
    const storedText = await stored.text()

    expect(stored.status).toBe(200)
    expect(credentialService.set).toHaveBeenCalledWith('VISION_API_KEY', 'sk-browser-entry')
    expect(storedText).not.toContain('sk-browser-entry')
  })

  it('rejects a stale or mismatched credential target before writing the secret', async () => {
    const { credentialService, post } = await setup()

    const stale = await post({
      action: 'credential', expectedRevision: 99, ref: 'VISION_API_KEY', value: 'sk-stale',
    })
    expect(stale.status).toBe(409)

    const mismatched = await post({
      action: 'credential', expectedRevision: 0, ref: 'OTHER_API_KEY', value: 'sk-wrong-target',
    })
    const mismatchedBody = await mismatched.json() as { ok: false; error: { code: string } }
    expect(mismatched.status).toBe(409)
    expect(mismatchedBody.error.code).toBe('credential-conflict')
    expect(credentialService.set).not.toHaveBeenCalled()
  })

  it('rejects credential writes for the read-only built-in free provider', async () => {
    const { credentialService, post } = await setup()
    const response = await post({
      action: 'credential', expectedRevision: 0, ref: 'ANIONEX_FREE_VISION', value: 'sk-must-not-persist',
    })
    const body = await response.json() as { ok: false; error: { code: string; message: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('credential-rejected')
    expect(body.error.message).toContain('built-in free vision provider')
    expect(credentialService.set).not.toHaveBeenCalled()
  })

  it('rejects wrapped or environment-assignment key pastes at the HTTP boundary', async () => {
    const { credentialService, post } = await setup()

    const assignment = await post({
      action: 'credential', expectedRevision: 0, ref: 'VISION_API_KEY', value: 'VISION_API_KEY=sk-value',
    })
    const quoted = await post({
      action: 'credential', expectedRevision: 0, ref: 'VISION_API_KEY', value: '"sk-value"',
    })

    expect(assignment.status).toBe(400)
    expect(quoted.status).toBe(400)
    expect(credentialService.set).not.toHaveBeenCalled()
  })

  it('runs no probe on reads and tests the connection only after the explicit action', async () => {
    const { manager, base, post } = await setup()
    await fetch(base)
    expect(manager.healthCalls).toEqual([])

    const local = await post({ action: 'health', testConnection: false })
    expect(local.status).toBe(200)
    const connection = await post({ action: 'health', testConnection: true })
    expect(connection.status).toBe(200)
    const model = await post({ action: 'health', testConnection: true, testModel: true })
    expect(model.status).toBe(200)
    expect(manager.healthCalls).toEqual([
      { testConnection: false, testModel: false, workspace: '/fixture/runtime' },
      { testConnection: true, testModel: false, workspace: '/fixture/runtime' },
      { testConnection: true, testModel: true, workspace: '/fixture/runtime' },
    ])
  })

  it('checks and applies a confirmed plugin update through explicit same-origin actions', async () => {
    const { updater, post } = await setup()
    const checked = await post({ action: 'check-update' })
    expect(checked.status).toBe(200)
    await expect(checked.json()).resolves.toMatchObject({
      ok: true,
      value: { latestVersion: '0.2.0', updateAvailable: true },
    })

    const applied = await post({ action: 'apply-update', expectedVersion: '0.2.0' })
    expect(applied.status).toBe(200)
    await expect(applied.json()).resolves.toMatchObject({
      ok: true,
      value: { toVersion: '0.2.0', restarting: true },
    })
    expect(updater.checks).toHaveBeenCalledTimes(1)
    expect(updater.installs).toHaveBeenCalledWith('0.2.0')
  })

  it('rejects an update request without a confirmed target version', async () => {
    const { updater, post } = await setup()
    const response = await post({ action: 'apply-update', expectedVersion: '' })
    expect(response.status).toBe(400)
    expect(updater.installs).not.toHaveBeenCalled()
  })

  it('rejects a model test that omits the API connection probe', async () => {
    const { manager, post } = await setup()
    const response = await post({ action: 'health', testConnection: false, testModel: true })
    expect(response.status).toBe(400)
    expect(manager.healthCalls).toEqual([])
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

describe('paste policy route', () => {
  it('answers the takeover verdict for a live Session and refuses other methods', async () => {
    const takeover = vi.fn(async (sessionId: string) => ({ takeOver: sessionId === 's1' }))
    const server = createServer((req, res) => { createPastePolicyHandler(takeover)(req, res) })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}`
    const route = `${base}/_dsh/vision-toolkit/paste-policy`

    const taken = await fetch(`${route}?sessionId=s1`, { headers: { Origin: base } })
    expect(taken.status).toBe(200)
    expect(await taken.json()).toEqual({ ok: true, value: { takeOver: true } })
    expect(takeover).toHaveBeenCalledWith('s1', undefined, undefined)

    const native = await fetch(`${route}?sessionId=s2`, { headers: { Origin: base } })
    expect(await native.json()).toEqual({ ok: true, value: { takeOver: false } })

    const post = await fetch(route, { method: 'POST', headers: { Origin: base } })
    expect(post.status).toBe(405)
  })

  it('forwards the model-selector label to the verdict resolver', async () => {
    const takeover = vi.fn(async (_sessionId: string, _selection: unknown, modelLabel?: string) => ({
      takeOver: modelLabel === 'DeepSeek V4 Flash',
    }))
    const server = createServer((req, res) => { createPastePolicyHandler(takeover)(req, res) })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}`
    const route = `${base}/_dsh/vision-toolkit/paste-policy`

    const taken = await fetch(`${route}?sessionId=s1&model=${encodeURIComponent('DeepSeek V4 Flash')}`, {
      headers: { Origin: base },
    })
    expect(await taken.json()).toEqual({ ok: true, value: { takeOver: true } })
    expect(takeover).toHaveBeenCalledWith('s1', undefined, 'DeepSeek V4 Flash')
  })

  it('forwards the exact model selection and echoes an auto-switch route', async () => {
    const takeover = vi.fn(async () => ({
      takeOver: false,
      autoSwitch: {
        provider: 'vision-toolkit-deepseek-official',
        model: 'deepseek-v4-flash',
        label: 'DeepSeek V4 Flash (Vision Toolkit)',
        reasoningEffort: 'medium',
      },
    }))
    const server = createServer((req, res) => { createPastePolicyHandler(takeover)(req, res) })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}`
    const route = `${base}/_dsh/vision-toolkit/paste-policy`
    const query = new URLSearchParams({
      sessionId: 's1',
      provider: 'deepseek-official',
      modelId: 'deepseek-v4-flash',
      reasoningEffort: 'medium',
      model: 'DeepSeek V4 Flash',
    })

    const response = await fetch(`${route}?${query.toString()}`, { headers: { Origin: base } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      value: {
        takeOver: false,
        autoSwitch: {
          provider: 'vision-toolkit-deepseek-official',
          model: 'deepseek-v4-flash',
          label: 'DeepSeek V4 Flash (Vision Toolkit)',
          reasoningEffort: 'medium',
        },
      },
    })
    expect(takeover).toHaveBeenCalledWith('s1', {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'medium',
    }, 'DeepSeek V4 Flash')
  })

  it('refuses duplicate exact-selection query parameters', async () => {
    const takeover = vi.fn(async () => ({ takeOver: false }))
    const server = createServer((req, res) => { createPastePolicyHandler(takeover)(req, res) })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}`
    const route = `${base}/_dsh/vision-toolkit/paste-policy`

    const duplicated = await fetch(
      `${route}?sessionId=s1&provider=a&provider=b&modelId=x&modelId=y`,
      { headers: { Origin: base } },
    )
    expect(duplicated.status).toBe(400)
    expect(takeover).not.toHaveBeenCalled()
  })

  it('refuses cross-origin and malformed policy requests', async () => {
    const takeover = vi.fn(async () => ({ takeOver: true }))
    const server = createServer((req, res) => { createPastePolicyHandler(takeover)(req, res) })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}`
    const route = `${base}/_dsh/vision-toolkit/paste-policy`

    const crossSite = await fetch(`${route}?sessionId=s1`, { headers: { Origin: 'https://attacker.example' } })
    expect(crossSite.status).toBe(403)

    const missing = await fetch(route, { headers: { Origin: base } })
    expect(missing.status).toBe(400)

    const duplicated = await fetch(`${route}?sessionId=s1&model=a&model=b`, { headers: { Origin: base } })
    expect(duplicated.status).toBe(400)

    expect(takeover).not.toHaveBeenCalled()
  })

  it('maps a verdict resolver failure to 500', async () => {
    const server = createServer((req, res) => {
      createPastePolicyHandler(async () => { throw new Error('llm exploded') })(req, res)
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}`

    const response = await fetch(`${base}/_dsh/vision-toolkit/paste-policy?sessionId=s1`, { headers: { Origin: base } })
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'policy-failed' } })
  })
})
