#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const upstream = packageJson.dsh?.visionToolkit
const commit = upstream?.upstreamSkillCommit
const repository = process.argv[2]
const patchPath = join(root, 'patches', 'vision-tools-dsh.patch')
const target = join(root, 'assets', 'skill')
const files = [
  'SKILL.md',
  'references/gui.md',
  'references/long-screenshot-ocr.md',
  'references/restore-graphic.md',
  'references/restore-structure.md',
  'references/restore-ui.md',
]

if (typeof repository !== 'string' || repository.length === 0) {
  throw new Error('usage: node scripts/sync-skill.mjs /path/to/agent-vision-toolkit')
}
if (typeof commit !== 'string' || commit.length !== 40) {
  throw new Error('package.json dsh.visionToolkit.upstreamSkillCommit must be a full commit hash')
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function capture(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const errors = []
    const child = spawn(program, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${program} timed out after 30000ms`))
    }, 30_000)
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.stderr.on('data', chunk => errors.push(chunk))
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`${program} exited with ${String(code)}: ${Buffer.concat(errors).toString('utf8').trim()}`))
    })
  })
}

async function snapshot(directory) {
  const result = []
  for (const path of files) {
    const bytes = await readFile(join(directory, ...path.split('/')))
    result.push({ path, bytes: bytes.length, sha256: sha256(bytes) })
  }
  return result
}

// Keep staging outside the plugin repository so `git apply` cannot discover
// the parent worktree and redirect paths to its root.
const staging = await mkdtemp(join(tmpdir(), 'dsh-vision-skill-'))
const adapted = join(staging, 'adapted')

try {
  const remote = (await capture('git', ['-C', repository, 'remote', 'get-url', 'origin'])).toString('utf8').trim()
  if (!/(?:^|[/:])Anionex\/agent-vision-toolkit(?:\.git)?$/.test(remote)) {
    throw new Error(`unexpected upstream origin: ${remote}`)
  }
  await capture('git', ['-C', repository, 'cat-file', '-e', `${commit}^{commit}`])
  await mkdir(adapted)

  const sourceFiles = []
  for (const path of files) {
    const upstreamPath = `skills/vision-tools/${path}`
    const bytes = await capture('git', ['-C', repository, 'show', `${commit}:${upstreamPath}`])
    const output = join(adapted, ...path.split('/'))
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, bytes)
    sourceFiles.push({ path, bytes: bytes.length, sha256: sha256(bytes) })
  }

  await capture('git', ['apply', '--check', patchPath], { cwd: adapted })
  await capture('git', ['apply', patchPath], { cwd: adapted })

  const patch = await readFile(patchPath)
  const manifest = {
    schemaVersion: 1,
    repository: upstream?.upstreamRepository,
    commit,
    patch: 'patches/vision-tools-dsh.patch',
    patchSha256: sha256(patch),
    sourceFiles,
    adaptedFiles: await snapshot(adapted),
  }
  await writeFile(join(adapted, 'UPSTREAM.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await chmod(join(adapted, 'UPSTREAM.json'), 0o644)

  await rm(target, { recursive: true, force: true })
  await rename(adapted, target)
  process.stdout.write(`${JSON.stringify({ ok: true, commit, files: files.length, target }, null, 2)}\n`)
} finally {
  await rm(staging, { recursive: true, force: true })
}
