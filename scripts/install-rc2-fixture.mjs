#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fixtureModules = join(root, '.github', 'fixtures', 'rc2', 'node_modules')
const rootModules = join(root, 'node_modules')
const packages = [
  '@deepseek-ai/cordis@4.0.1-rc.1',
  '@deepseek-ai/schemastery@3.18.1-rc.1',
  '@deepseek-ai/dsh-agent@0.0.1-rc.2',
  '@deepseek-ai/dsh-api-gateway@0.0.1-rc.2',
  '@deepseek-ai/dsh-api-remotes@0.0.1-rc.2',
  '@deepseek-ai/dsh-attachment@0.0.1-rc.2',
  '@deepseek-ai/dsh-brand@0.0.1-rc.2',
  '@deepseek-ai/dsh-client-locale@0.0.1-rc.2',
  '@deepseek-ai/dsh-client-runtime@0.0.1-rc.2',
  '@deepseek-ai/dsh-client-ui-conversation@0.0.1-rc.2',
  '@deepseek-ai/dsh-client-ui-primitives@0.0.1-rc.2',
  '@deepseek-ai/dsh-client-ui-settings@0.0.1-rc.2',
  '@deepseek-ai/dsh-client-ui-slots@0.0.1-rc.2',
  '@deepseek-ai/dsh-client-ui-tool@0.0.1-rc.2',
  '@deepseek-ai/dsh-code-runtime@0.0.1-rc.2',
  '@deepseek-ai/dsh-commands@0.0.1-rc.2',
  '@deepseek-ai/dsh-credentials@0.0.1-rc.2',
  '@deepseek-ai/dsh-host-webserver@0.0.1-rc.2',
  '@deepseek-ai/dsh-invariants@0.0.1-rc.2',
  '@deepseek-ai/dsh-llm@0.0.1-rc.2',
  '@deepseek-ai/dsh-llm-retry@0.0.1-rc.2',
  '@deepseek-ai/dsh-scope@0.0.1-rc.2',
  '@deepseek-ai/dsh-session@0.0.1-rc.2',
  '@deepseek-ai/dsh-session-projection@0.0.1-rc.2',
  '@deepseek-ai/dsh-session-title@0.0.1-rc.2',
  '@deepseek-ai/dsh-settings@0.0.1-rc.2',
  '@deepseek-ai/dsh-skill@0.0.1-rc.2',
  '@deepseek-ai/dsh-subprocess@0.0.1-rc.2',
  '@deepseek-ai/dsh-subprocess-local@0.0.1-rc.2',
  '@deepseek-ai/dsh-system-prompt@0.0.1-rc.2',
  '@deepseek-ai/dsh-timeout@0.0.1-rc.2',
  '@deepseek-ai/dsh-tool-skill@0.0.1-rc.2',
  '@deepseek-ai/dsh-tools@0.0.1-rc.2',
  '@deepseek-ai/dsh-typert-registry@0.0.1-rc.2',
  '@deepseek-ai/dsh-user-approval@0.0.1-rc.2',
]

function packageName(spec) {
  const split = spec.lastIndexOf('@')
  if (split <= 0) throw new Error(`invalid fixture package spec: ${spec}`)
  return spec.slice(0, split)
}

async function extract(spec, staging) {
  const { stdout } = await execFileAsync('npm', [
    'pack', spec, '--ignore-scripts', '--pack-destination', staging, '--json',
  ], { cwd: root, maxBuffer: 10 * 1024 * 1024 })
  const rows = JSON.parse(stdout)
  const filename = rows[0]?.filename
  if (typeof filename !== 'string' || filename === '') throw new Error(`npm pack returned no filename for ${spec}`)
  const name = packageName(spec)
  const target = join(fixtureModules, ...name.split('/'))
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await execFileAsync('tar', ['-xzf', join(staging, filename), '--strip-components=1', '-C', target])
  const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
  if (`${manifest.name}@${manifest.version}` !== spec) {
    throw new Error(`${spec} extracted as ${String(manifest.name)}@${String(manifest.version)}`)
  }
}

const staging = await mkdtemp(join(tmpdir(), 'dvt-rc2-fixture-'))
try {
  await Promise.all(packages.map(spec => extract(spec, staging)))
  try {
    const info = await lstat(rootModules)
    if (!info.isSymbolicLink() || await realpath(rootModules) !== await realpath(fixtureModules)) {
      throw new Error(`${rootModules} already exists and is not the rc.2 fixture link`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await symlink(join('.github', 'fixtures', 'rc2', 'node_modules'), rootModules, 'dir')
  }
  process.stdout.write(`installed ${packages.length} packed rc.2 fixture packages\n`)
} finally {
  await rm(staging, { recursive: true, force: true })
}
