#!/usr/bin/env node

// Prepares assets/python-bootstrap.json archives in .python-bootstrap-dist and
// prints the coscmd command used to publish them to the domestic COS mirror.
// Usage: node scripts/python-bootstrap-mirror.mjs

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'assets', 'python-bootstrap.json')
const distRoot = join(root, '.python-bootstrap-dist')
const COS_BUCKET = 'dsh-vision-python-bootstrap-1317715800'
const COS_REGION = 'ap-guangzhou'
const MIRROR_BASE_URL = 'https://dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com'

async function sha256File(path) {
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyOrDownload(artifact, destination, expectedSize, expectedSha256) {
  try {
    const info = await stat(destination)
    if (info.size === expectedSize && await sha256File(destination) === expectedSha256) return false
  } catch {
    // Missing or incomplete; download below.
  }
  const response = await fetch(artifact.url, {
    headers: { 'user-agent': 'dsh-vision-toolkit-python-bootstrap' },
  })
  if (!response.ok) throw new Error(`download returned HTTP ${response.status}`)
  const hash = createHash('sha256')
  let bytes = 0
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      bytes += chunk.length
      callback(null, chunk)
    },
  })
  await pipeline(response.body, hasher, createWriteStream(destination))
  if (bytes !== expectedSize) throw new Error(`size mismatch: expected ${expectedSize}, received ${bytes}`)
  if (hash.digest('hex') !== expectedSha256) throw new Error('sha256 mismatch')
  return true
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const tag = manifest.buildTag
let downloaded = 0
for (const artifact of Object.values(manifest.artifacts ?? {})) {
  const name = artifact.url.split('/').pop()
  const destination = join(distRoot, tag, name)
  await mkdir(dirname(destination), { recursive: true })
  if (await verifyOrDownload(artifact, destination, artifact.size, artifact.sha256)) {
    downloaded += 1
    process.stdout.write(`downloaded ${name}\n`)
  }
}
process.stdout.write(`python-bootstrap-mirror: ${Object.keys(manifest.artifacts ?? {}).length} archives ready in ${join(distRoot, tag)}\n`)
process.stdout.write(`publish with:\n  cd "${join(distRoot, tag)}" && uvx coscmd -b ${COS_BUCKET} -r ${COS_REGION} upload -y -r . "${tag}/"\n`)
process.stdout.write(`verify at ${MIRROR_BASE_URL}/${tag}/<archive>\n`)
