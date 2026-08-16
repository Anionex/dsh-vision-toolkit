#!/usr/bin/env node

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const varsPath = fileURLToPath(new URL('../.dev.vars', import.meta.url))
const original = existsSync(varsPath) ? readFileSync(varsPath, 'utf8') : null
const hasSecret = original?.split(/\r?\n/).some(line => line.startsWith('IP_HASH_SECRET=')) ?? false

try {
  if (!hasSecret) {
    const prefix = original && !original.endsWith('\n') ? `${original}\n` : original ?? ''
    writeFileSync(varsPath, `${prefix}IP_HASH_SECRET=types-only-placeholder-value\n`)
  }
  const result = spawnSync(process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler', [
    'types',
    ...(process.argv.includes('--check') ? ['--check'] : []),
  ], {
    cwd: root,
    stdio: 'inherit',
    timeout: 60_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  if (original === null) unlinkSync(varsPath)
  else if (!hasSecret) writeFileSync(varsPath, original)
}
