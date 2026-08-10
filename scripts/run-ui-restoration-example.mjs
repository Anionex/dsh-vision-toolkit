/** Launch the TypeScript UI-restoration verifier from the repository root. */

import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(pluginRoot, '..')
const runner = join(pluginRoot, 'scripts', 'ui-restoration-example.ts')

const child = spawn(process.execPath, ['--import', 'tsx/esm', runner, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    TSX_TSCONFIG_PATH: join(repositoryRoot, 'tsconfig.base.json'),
  },
  stdio: 'inherit',
})

child.once('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`UI restoration verifier terminated by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
