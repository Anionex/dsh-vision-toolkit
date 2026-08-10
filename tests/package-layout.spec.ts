import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
  dsh?: { bundle?: { patch?: string } }
  peerDependencies?: Record<string, string>
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
  })

  it('ships runtime, pinned upstream, lib, src, patch, and docs in files', () => {
    for (const required of ['lib', 'src', 'runtime', 'vendor', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE']) {
      expect(PACKAGE.files).toContain(required)
    }
  })

  it('has reproducible build and prepack scripts', () => {
    expect(PACKAGE.scripts.build).toContain('node scripts/upstream-manifest.mjs')
    expect(PACKAGE.scripts.build).toContain('tsc -p tsconfig.json')
    expect(PACKAGE.scripts['upstream:sync']).toBe('node scripts/sync-upstream.mjs')
    expect(PACKAGE.scripts['upstream:manifest']).toContain('--write')
    expect(PACKAGE.scripts.prepack).toBe('npm run build')
    expect(PACKAGE.scripts.test).toContain('vitest')
  })

  it('keeps every dependency specifier portable', () => {
    for (const section of [PACKAGE.peerDependencies ?? {}, PACKAGE.devDependencies ?? {}]) {
      for (const [name, spec] of Object.entries(section)) {
        expect(spec, `${name}`).not.toMatch(/^\/|^[A-Za-z]:\\|^file:|^link:|^workspace:/)
      }
    }
  })

  it('emits no raw .ts relative imports in built JavaScript', async () => {
    const text = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
    expect(text).not.toMatch(/from '\.\/[^']+\.ts'/)
  })
})
