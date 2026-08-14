#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'lib', 'BUILD_MANIFEST.json')

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(path))
    else if (entry.isFile() && path !== manifestPath) files.push(path)
  }
  return files
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function rows(paths) {
  const result = []
  for (const path of paths.sort()) {
    const bytes = await readFile(path)
    result.push({
      path: relative(root, path).split('\\').join('/'),
      bytes: bytes.length,
      sha256: sha256(bytes),
    })
  }
  return result
}

const inputs = [
  ...await filesBelow(join(root, 'src')),
  join(root, 'scripts', 'build-client.mjs'),
  join(root, 'tsconfig.json'),
  join(root, 'tsconfig.client.json'),
]
const next = {
  schemaVersion: 1,
  inputs: await rows(inputs),
  outputs: await rows(await filesBelow(join(root, 'lib'))),
}

if (process.argv.includes('--write')) {
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
  process.stdout.write(`wrote ${manifestPath}\n`)
} else {
  const current = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    process.stderr.write('built artifacts differ from lib/BUILD_MANIFEST.json; run npm run build\n')
    process.exitCode = 1
  }
}
