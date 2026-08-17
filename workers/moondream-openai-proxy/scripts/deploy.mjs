#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const dryRun = process.argv.includes('--dry-run')
const wrangler = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'

function run(args, options = {}) {
  const result = spawnSync(wrangler, args, {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: options.timeout ?? 120_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? '')
      process.stderr.write(result.stderr ?? '')
    }
    throw new Error(`wrangler ${args.join(' ')} failed with exit code ${result.status}`)
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

try {
  run(['whoami'], { timeout: 30_000 })
  const secrets = run(['secret', 'list'], { capture: true, timeout: 30_000 })
  const requiredSecrets = [
    'IP_HASH_SECRET',
    'GROQ_API_KEY_1',
    'GROQ_API_KEY_2',
    'GROQ_API_KEY_3',
    'GROQ_API_KEY_4',
    'GROQ_API_KEY_5',
    'FALLBACK_VISION_API_KEY',
    'FALLBACK_VISION_MODEL',
    'FALLBACK_VISION_URL',
  ]
  const missingSecrets = requiredSecrets.filter(name => !new RegExp(`"name"\\s*:\\s*"${name}"`).test(secrets))
  if (missingSecrets.length > 0) {
    throw new Error(`Required Worker secrets are missing: ${missingSecrets.join(', ')}`)
  }
  if (dryRun) {
    const migrations = run(
      ['d1', 'migrations', 'list', 'dsh-vision-free-usage', '--remote'],
      { capture: true, timeout: 60_000 },
    )
    if (!migrations.includes('No migrations to apply!')) {
      process.stderr.write(migrations)
      throw new Error('Pending D1 migrations must be applied before deployment')
    }
    run(['deploy', '--dry-run', '--minify'])
  } else {
    run(['d1', 'migrations', 'apply', 'dsh-vision-free-usage', '--remote'])
    run(['deploy', '--minify'])
  }
  process.stdout.write(`${JSON.stringify({ dryRun, status: 'ok', worker: 'dsh-vision-free' })}\n`)
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    status: 'failed',
    worker: 'dsh-vision-free',
  })}\n`)
  process.exitCode = 1
}
