#!/usr/bin/env node

// Maintains assets/python-bootstrap.json, the pinned python-build-standalone
// download manifest used when no system Python 3.11+ is available.
// Usage: node scripts/python-bootstrap.mjs [--write]

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const MANIFEST_PATH = join(root, 'assets', 'python-bootstrap.json')
const RELEASE_API = 'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest'
const PYTHON_MAJOR_MINOR = '3.13'
const ARTIFACT_SUFFIX = '-install_only_stripped.tar.gz'

const TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64-musl': 'x86_64-unknown-linux-musl',
  'linux-arm64-musl': 'aarch64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
}

function fail(message) {
  process.stderr.write(`python-bootstrap: ${message}\n`)
  process.exitCode = 1
}

async function readExisting() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  } catch (error) {
    return undefined
  }
}

async function fetchRelease() {
  const response = await fetch(RELEASE_API, {
    headers: { 'User-Agent': 'dsh-vision-toolkit-python-bootstrap' },
  })
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`)
  return await response.json()
}

function validateManifest(manifest) {
  if (manifest === undefined || typeof manifest !== 'object' || manifest === null) return 'manifest is not an object'
  if (manifest.schemaVersion !== 1) return `unsupported schemaVersion: ${String(manifest.schemaVersion)}`
  if (typeof manifest.pythonVersion !== 'string' || !manifest.pythonVersion.startsWith(`${PYTHON_MAJOR_MINOR}.`)) {
    return `pythonVersion must be a ${PYTHON_MAJOR_MINOR} release`
  }
  if (typeof manifest.buildTag !== 'string' || !/^\d{8}$/u.test(manifest.buildTag)) return 'buildTag must be YYYYMMDD'
  if (typeof manifest.artifacts !== 'object' || manifest.artifacts === null) return 'artifacts is missing'
  const targets = Object.keys(TARGETS)
  for (const target of targets) {
    const artifact = manifest.artifacts[target]
    if (artifact === undefined || typeof artifact !== 'object' || artifact === null) return `artifact missing: ${target}`
    if (typeof artifact.url !== 'string' || !artifact.url.startsWith('https://github.com/astral-sh/python-build-standalone/releases/download/')) {
      return `artifact ${target} has an invalid url`
    }
    if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) return `artifact ${target} has an invalid sha256`
    if (!Number.isInteger(artifact.size) || artifact.size <= 0) return `artifact ${target} has an invalid size`
  }
  for (const target of Object.keys(manifest.artifacts)) {
    if (!targets.includes(target)) return `unexpected artifact target: ${target}`
  }
  return undefined
}

async function buildManifest(release) {
  const tag = release?.tag_name
  const assets = Array.isArray(release?.assets) ? release.assets : []
  if (typeof tag !== 'string' || !/^\d{8}$/u.test(tag)) throw new Error(`unexpected release tag: ${String(tag)}`)
  const artifacts = {}
  for (const [target, triple] of Object.entries(TARGETS)) {
    const name = assets.find(asset => {
      if (typeof asset?.name !== 'string') return false
      if (!asset.name.startsWith(`cpython-${PYTHON_MAJOR_MINOR}.`)) return false
      if (!asset.name.endsWith(ARTIFACT_SUFFIX)) return false
      if (asset.name.includes('freethreaded')) return false
      return asset.name.includes(`-${triple}-install_only_stripped.tar.gz`)
    })?.name
    if (name === undefined) throw new Error(`no ${PYTHON_MAJOR_MINOR} install_only_stripped artifact for ${target}`)
    const asset = assets.find(candidate => candidate?.name === name)
    const digest = typeof asset?.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : undefined
    if (!/^[a-f0-9]{64}$/u.test(digest ?? '')) throw new Error(`missing sha256 digest for ${name}`)
    if (!Number.isInteger(asset.size) || asset.size <= 0) throw new Error(`missing size for ${name}`)
    artifacts[target] = {
      url: `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${name}`,
      sha256: digest,
      size: asset.size,
    }
  }
  const manifest = {
    schemaVersion: 1,
    pythonVersion: (assets.find(asset => typeof asset?.name === 'string' && asset.name.startsWith(`cpython-${PYTHON_MAJOR_MINOR}.`))?.name ?? '').match(/^cpython-([0-9.]+)\+/u)?.[1],
    buildTag: tag,
    artifacts,
  }
  const error = validateManifest(manifest)
  if (error !== undefined) throw new Error(error)
  return manifest
}

async function main() {
  const write = process.argv.includes('--write')
  const existing = await readExisting()
  const existingError = validateManifest(existing)
  if (write) {
    try {
      const manifest = await buildManifest(await fetchRelease())
      await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
      process.stdout.write(`python-bootstrap: wrote ${manifest.pythonVersion} (${manifest.buildTag}) with ${Object.keys(manifest.artifacts).length} targets\n`)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    return
  }
  if (existingError !== undefined) {
    fail(existingError)
    return
  }
  process.stdout.write(`python-bootstrap: verified ${existing.pythonVersion} (${existing.buildTag}) with ${Object.keys(existing.artifacts).length} targets\n`)
}

await main()
