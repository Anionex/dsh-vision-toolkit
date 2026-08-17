#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const skillRoot = join(root, 'assets', 'skill')
const manifest = JSON.parse(await readFile(join(skillRoot, 'UPSTREAM.json'), 'utf8'))
const patch = await readFile(join(root, 'patches', 'vision-tools-dsh.patch'))
const errors = []

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function check(condition, message) {
  if (!condition) errors.push(message)
}

check(manifest.schemaVersion === 1, 'UPSTREAM.json schemaVersion must be 1')
check(manifest.repository === packageJson.dsh?.visionToolkit?.upstreamRepository, 'skill repository metadata differs from package.json')
check(manifest.commit === packageJson.dsh?.visionToolkit?.upstreamSkillCommit, 'skill commit metadata differs from package.json')
check(manifest.patchSha256 === sha256(patch), 'vision-tools-dsh.patch differs from UPSTREAM.json')

const expectedReferences = [
  'references/gui.md',
  'references/long-screenshot-ocr.md',
  'references/restore-graphic.md',
  'references/restore-structure.md',
  'references/restore-ui.md',
]
const expectedFiles = ['SKILL.md', ...expectedReferences]
const adaptedFiles = Array.isArray(manifest.adaptedFiles) ? manifest.adaptedFiles : []
check(adaptedFiles.length === expectedFiles.length, `expected ${expectedFiles.length} adapted skill files`)

for (const path of expectedFiles) {
  const record = adaptedFiles.find(candidate => candidate.path === path)
  check(record !== undefined, `UPSTREAM.json is missing ${path}`)
  if (record === undefined) continue
  const bytes = await readFile(join(skillRoot, ...path.split('/')))
  check(record.bytes === bytes.length, `${path} byte count differs from UPSTREAM.json`)
  check(record.sha256 === sha256(bytes), `${path} hash differs from UPSTREAM.json`)
}

const content = await readFile(join(skillRoot, 'SKILL.md'), 'utf8')
check(content.startsWith('# vision-skills\n'), 'adapted SKILL.md must use the vision-skills title')
check(content.includes('`/vision-skills`'), 'adapted SKILL.md must reference the vision-skills invocation')
for (const name of [
  'vision_glance',
  'vision_ground',
  'vision_detect',
  'vision_trace',
  'vision_crop',
  'vision_pixel_diff',
  'vision_long_screenshot_ocr',
  'vision_extract_foreground',
  'vision_dominant_colors',
  'vision_html_screenshot',
  'vision_toolkit_activate',
]) check(content.includes(name), `SKILL.md does not mention ${name}`)
for (const path of expectedReferences) check(content.includes(`\`${path}\``), `SKILL.md does not link ${path}`)

const combined = (await Promise.all(expectedFiles.map(path => readFile(join(skillRoot, ...path.split('/')), 'utf8')))).join('\n')
for (const legacy of [
  /```bash/,
  /python3\s+(?:scripts\/)?(?:long_screenshot_ocr|extract_fg|html_shot|pixel_diff|dominant_colors)\.py/,
  /(?:^|\s)(?:glance|ground|detect|trace|crop)\s+<[^>]+>/m,
]) check(!legacy.test(combined), `adapted skill still contains CLI-only syntax: ${legacy}`)

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, errors }, null, 2)}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, commit: manifest.commit, files: expectedFiles.length }, null, 2)}\n`)
}
