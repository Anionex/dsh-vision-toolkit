#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const commit = packageJson.dsh?.visionToolkit?.upstreamCommit
const repository = process.argv[2]

if (typeof repository !== 'string' || repository.length === 0) {
  throw new Error('usage: node scripts/sync-upstream.mjs /path/to/agent-vision-toolkit')
}
if (typeof commit !== 'string' || commit.length !== 40) {
  throw new Error('package.json dsh.visionToolkit.upstreamCommit must be a full commit hash')
}

function capture(program, args) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const errors = []
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.stderr.on('data', chunk => errors.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`${program} exited with ${String(code)}: ${Buffer.concat(errors).toString('utf8').trim()}`))
    })
  })
}

const staging = await mkdtemp(join(root, '.upstream-sync-'))
const extracted = join(staging, 'agent-vision-toolkit')
const target = join(root, 'vendor', 'agent-vision-toolkit')
const roots = [
  'LICENSE',
  'README.md',
  'CHANGELOG.md',
  'vision_client.py',
  'ground.py',
  'detect.py',
  'bin',
  'skills/vision-tools/scripts',
  'tests/test_vision_client.py',
]

try {
  await mkdir(extracted)
  const listed = await capture('git', ['-C', repository, 'ls-tree', '-r', commit, '--', ...roots])
  const files = listed.toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const match = /^(\d+)\s+blob\s+[0-9a-f]+\t(.+)$/.exec(line)
    if (match === null) throw new Error(`cannot parse upstream tree entry: ${line}`)
    return { executable: match[1] === '100755', path: match[2] }
  })
  if (files.length === 0) throw new Error(`upstream commit ${commit} contains none of the required files`)
  for (const file of files) {
    const bytes = await capture('git', ['-C', repository, 'show', `${commit}:${file.path}`])
    const output = join(extracted, ...file.path.split('/'))
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, bytes)
    if (file.executable) await chmod(output, 0o755)
  }
  await rm(target, { recursive: true, force: true })
  await rename(extracted, target)
  await capture(process.execPath, [join(root, 'scripts', 'upstream-manifest.mjs'), '--write'])
} finally {
  await rm(staging, { recursive: true, force: true })
}
