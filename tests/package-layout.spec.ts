import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const PACKAGE = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
  name: string
  main: string
  types: string
  exports: Record<string, unknown>
  files: string[]
  scripts: Record<string, string>
  dsh?: {
    bundle?: { patch?: string }
    client?: { platform?: string; inject?: string[] }
  }
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  devDependencies?: Record<string, string>
}

describe('package layout contract', () => {
  it('is a bundle with a declared patch', async () => {
    expect(PACKAGE.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    await expect(stat(join(ROOT, 'cordis.patch.yml'))).resolves.toBeDefined()
  })

  it('points main/types/exports at built artifacts', async () => {
    expect(PACKAGE.main).toBe('lib/index.js')
    expect(PACKAGE.types).toBe('lib/types/index.d.ts')
    const entry = PACKAGE.exports['.'] as { types?: string; default?: string }
    expect(entry.types).toBe('./lib/types/index.d.ts')
    expect(entry.default).toBe('./lib/index.js')
    await expect(stat(join(ROOT, 'lib', 'index.js'))).resolves.toBeDefined()
    await expect(stat(join(ROOT, 'lib', 'types', 'index.d.ts'))).resolves.toBeDefined()
    await expect(stat(join(ROOT, 'lib', 'exposure.js'))).resolves.toBeDefined()
    await expect(stat(join(ROOT, 'lib', 'types', 'exposure.d.ts'))).resolves.toBeDefined()
    const client = PACKAGE.exports['./client'] as { types?: string; default?: string }
    expect(client.types).toBe('./lib/types/client/index.d.ts')
    expect(client.default).toBe('./lib/client.js')
    await expect(stat(join(ROOT, 'lib', 'client.js'))).resolves.toBeDefined()
    await expect(stat(join(ROOT, 'lib', 'types', 'client', 'index.d.ts'))).resolves.toBeDefined()
  })

  it('declares a loader-compatible Web client and its slot dependencies', () => {
    expect(PACKAGE.dsh?.client?.platform).toBe('web')
    expect(PACKAGE.dsh?.client?.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-input-trigger',
      '@deepseek-ai/dsh-client-ui-tool',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-locale',
    ]))
    expect(PACKAGE.dsh?.client?.inject).not.toContain('@deepseek-ai/dsh-client-ui-slash')
    expect(PACKAGE.peerDependenciesMeta).toEqual({
      '@deepseek-ai/dsh-host-webserver': { optional: true },
    })
  })

  it('ships runtime, pinned upstream, lib, src, patch, and docs in files', () => {
    for (const required of ['lib', 'src', 'runtime', 'vendor', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE']) {
      expect(PACKAGE.files).toContain(required)
    }
  })

  it('has reproducible build and prepack scripts', () => {
    expect(PACKAGE.scripts.build).toContain('node scripts/upstream-manifest.mjs')
    expect(PACKAGE.scripts.build).toContain('tsc -p tsconfig.json')
    expect(PACKAGE.scripts.build).toContain('tsc -p tsconfig.client.json')
    expect(PACKAGE.scripts.build).toContain('tsc -p tsconfig.client.public.json')
    expect(PACKAGE.scripts.build).toContain('node scripts/build-client.mjs')
    expect(PACKAGE.scripts['upstream:sync']).toBe('node scripts/sync-upstream.mjs')
    expect(PACKAGE.scripts['upstream:manifest']).toContain('--write')
    expect(PACKAGE.scripts.prepack).toBe('npm run build')
    expect(PACKAGE.scripts.test).toContain('vitest')
  })

  it('pins the only dependency install scripts allowed in standalone CI', async () => {
    const workspace = await readFile(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
    expect(workspace).toContain("'@deepseek-ai/dsh-subprocess-local@0.1.0-rc.6': true")
    expect(workspace).toContain("'node-pty@1.1.0': true")
  })

  it('keeps every dependency specifier portable', () => {
    expect(PACKAGE.peerDependencies).toHaveProperty('@deepseek-ai/dsh-agent')
    expect(PACKAGE.peerDependencies).toHaveProperty('@deepseek-ai/cordis')
    expect(PACKAGE.peerDependencies).toHaveProperty('@deepseek-ai/schemastery')
    expect(PACKAGE.peerDependencies).not.toHaveProperty('cordis')
    expect(PACKAGE.peerDependencies).not.toHaveProperty('schemastery')
    for (const section of [PACKAGE.dependencies ?? {}, PACKAGE.peerDependencies ?? {}, PACKAGE.devDependencies ?? {}]) {
      for (const [name, spec] of Object.entries(section)) {
        expect(spec, `${name}`).not.toMatch(/^\/|^[A-Za-z]:\\|^file:|^link:|^workspace:/)
      }
    }
  })

  it('targets the published DSH prerelease line without retired package names', () => {
    const peers = PACKAGE.peerDependencies ?? {}
    for (const [name, spec] of Object.entries(peers)) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(spec, name).toBe('^0.1.0-rc.6')
    }
    expect(peers).toHaveProperty('@deepseek-ai/dsh-client-ui-input-trigger')
    expect(peers).not.toHaveProperty('@deepseek-ai/dsh-client-ui-slash')
    expect(peers).not.toHaveProperty('@deepseek-ai/dsh-host-apiproxy')
    expect(PACKAGE.peerDependenciesMeta?.['@deepseek-ai/dsh-host-webserver']?.optional).toBe(true)
    expect(PACKAGE.dsh?.client?.inject).not.toContain('@deepseek-ai/dsh-client-ui-slash')
  })

  it('emits no raw .ts relative imports in built JavaScript', async () => {
    const text = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
    expect(text).not.toMatch(/from '\.\/[^']+\.ts'/)
    const config = await readFile(join(ROOT, 'lib', 'config.js'), 'utf8')
    expect(config).toContain("from '@deepseek-ai/schemastery'")
    expect(config).not.toContain("from 'schemastery'")
    const client = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
    expect(client).toContain('window.__ModuleLoader__.load({ id: "@dsh-external/dsh-vision-toolkit"')
    expect(client).not.toMatch(/require\("\.\//)
  })

  it('indexes each client source map section at the generated module source line', async () => {
    const client = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
    const indexedMap = JSON.parse(await readFile(join(ROOT, 'lib', 'client.js.map'), 'utf8')) as {
      sections: Array<{
        offset: { line: number; column: number }
        map: { sources: string[] }
      }>
    }
    const outputLines = client.split('\n')
    expect(indexedMap.sections.length).toBeGreaterThan(1)
    for (const section of indexedMap.sections) {
      const source = section.map.sources[0]
      if (source === undefined) throw new Error('client source map section has no source')
      await expect(stat(resolve(ROOT, 'lib', source)), source).resolves.toBeDefined()
      const leaf = source.slice(source.lastIndexOf('/') + 1).replace(/\.[^.]+$/u, '.js')
      const wrapper = `__modules["./${leaf}"] = function(module, exports, require, __load_) {`
      const wrapperLine = outputLines.indexOf(wrapper)
      expect(wrapperLine, source).toBeGreaterThanOrEqual(0)
      expect(section.offset).toEqual({ line: wrapperLine + 1, column: 0 })
    }
  })
})
