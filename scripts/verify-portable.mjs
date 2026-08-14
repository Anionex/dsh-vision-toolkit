#!/usr/bin/env node

import { access, cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && ['.git', '.dsh-vision-toolkit', 'node_modules'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function localTargets(markdown) {
  const targets = []
  const markdownLink = /!?(?:\[[^\]]*\])\(([^)]+)\)/g
  const htmlLink = /(?:src|href)="([^"]+)"/g
  for (const expression of [markdownLink, htmlLink]) {
    for (const match of markdown.matchAll(expression)) {
      const raw = match[1]?.trim()
      if (raw === undefined || raw === '') continue
      const target = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw.split(/\s+["']/u, 1)[0]
      if (target === undefined || /^(?:https?:|mailto:|data:|#)/u.test(target)) continue
      targets.push(decodeURIComponent(target.split('#', 1)[0] ?? target))
    }
  }
  return targets
}

function pngDimensions(bytes) {
  const signature = '89504e470d0a1a0a'
  check(bytes.subarray(0, 8).toString('hex') === signature, 'PNG signature is invalid')
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' })
}

async function verifyWindowsCheckout() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-vision-autocrlf-'))
  const seed = join(temporaryRoot, 'seed')
  const checkout = join(temporaryRoot, 'checkout')
  try {
    await mkdir(join(seed, 'scripts'), { recursive: true })
    await mkdir(join(seed, 'vendor'), { recursive: true })
    await cp(join(root, '.gitattributes'), join(seed, '.gitattributes'))
    await cp(join(root, 'package.json'), join(seed, 'package.json'))
    await cp(join(root, 'scripts', 'upstream-manifest.mjs'), join(seed, 'scripts', 'upstream-manifest.mjs'))
    await cp(join(root, 'vendor', 'agent-vision-toolkit'), join(seed, 'vendor', 'agent-vision-toolkit'), { recursive: true })
    await writeFile(join(seed, 'autocrlf-probe.txt'), 'line one\nline two\n')

    const setupCommands = [
      ['init', '--quiet'],
      ['config', 'user.name', 'DSH portable verification'],
      ['config', 'user.email', 'portable@example.invalid'],
      ['config', 'core.autocrlf', 'false'],
      ['add', '.'],
      ['commit', '--quiet', '-m', 'checkout fixture'],
    ]
    for (const args of setupCommands) {
      const result = run('git', args, seed)
      if (result.status !== 0) {
        failures.push(`could not prepare Windows checkout fixture: ${(result.stderr || result.stdout).trim()}`)
        return
      }
    }

    const clone = run('git', ['-c', 'core.autocrlf=true', 'clone', '--no-local', '--quiet', seed, checkout], temporaryRoot)
    if (clone.status !== 0) {
      failures.push(`core.autocrlf=true checkout failed: ${(clone.stderr || clone.stdout).trim()}`)
      return
    }
    const probe = await readFile(join(checkout, 'autocrlf-probe.txt'))
    check(probe.includes(Buffer.from('\r\n')), 'core.autocrlf=true checkout fixture did not exercise CRLF conversion')

    const manifest = run(process.execPath, ['scripts/upstream-manifest.mjs'], checkout)
    if (manifest.status !== 0) {
      failures.push(`vendored upstream is not byte-stable under core.autocrlf=true: ${(manifest.stderr || manifest.stdout).trim()}`)
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

const packagePath = join(root, 'package.json')
const pkg = JSON.parse(await readFile(packagePath, 'utf8'))

check(pkg.name === '@dsh-external/dsh-vision-toolkit', 'package name must stay @dsh-external/dsh-vision-toolkit')
check(pkg.version === '0.1.2', 'package version and the latest release notes must stay aligned')
check(pkg.repository?.url === 'git+https://github.com/Anionex/dsh-vision-toolkit.git', 'repository URL is missing or mismatched')
check(pkg.bugs?.url === 'https://github.com/Anionex/dsh-vision-toolkit/issues', 'issue tracker URL is missing or mismatched')
check(pkg.homepage === 'https://agent-vision.anionex.me', 'homepage URL is missing or mismatched')
check(pkg.funding === 'https://ifdian.net/a/anionex', 'funding metadata is missing or mismatched')
check(pkg.engines?.node === '^22.19.0 || >=24.0.0', 'Node.js engine range must match DeepSeek Harness')
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch must publish cordis.patch.yml')
check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform must publish the Web client')
check(pkg.dshClient === undefined, 'legacy top-level dshClient metadata must remain absent')
check(pkg.exports?.['./client']?.default === './lib/client.js', 'the Web client export must resolve to lib/client.js')
check(Array.isArray(pkg.files) && pkg.files.includes('assets'), 'package files must include README visual assets')
check(pkg.scripts?.['verify:portable'] === 'node scripts/upstream-manifest.mjs && node scripts/verify-portable.mjs', 'verify:portable script is missing or changed')
check(pkg.peerDependencies?.['@deepseek-ai/schemastery'] === '^3.18.1-rc.1', '@deepseek-ai/schemastery must be a host-provided peer dependency')
check(pkg.peerDependencies?.schemastery === undefined, 'unscoped schemastery peer dependency must remain absent')
check(pkg.peerDependencies?.['@deepseek-ai/cordis'] === '>=4.0.0-rc.7 <5.0.0', '@deepseek-ai/cordis must be a host-provided peer dependency')
check(pkg.peerDependencies?.cordis === undefined, 'unscoped cordis peer dependency must remain absent')

const dependencyGroups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
for (const group of dependencyGroups) {
  for (const [name, spec] of Object.entries(pkg[group] ?? {})) {
    check(typeof spec === 'string', `${group}.${name} must be a string`)
    if (typeof spec !== 'string') continue
    check(!/^(?:file:|link:|\/|[A-Za-z]:[\\/])/u.test(spec), `${group}.${name} uses a machine-local dependency: ${spec}`)
    check(!spec.includes('/Users/') && !spec.includes('\\Users\\'), `${group}.${name} contains a machine-local path: ${spec}`)
  }
}

const requiredFiles = [
  '.gitattributes',
  'LICENSE',
  'README.md',
  'README.zh.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'SUPPORT.md',
  'FUNDING.md',
  '.github/FUNDING.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/question.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/pages.yml',
  'index.html',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/types/index.d.ts',
  'lib/client.js',
  'assets/hero.png',
  'assets/social-preview.png',
  'runtime/requirements.lock',
  'vendor/agent-vision-toolkit/UPSTREAM_MANIFEST.json',
]
for (const path of requiredFiles) {
  check(await exists(join(root, path)), `required file is missing: ${path}`)
}

const publicRepositoryFiles = [
  '.github/ISSUE_TEMPLATE/config.yml',
  'CHANGELOG.md',
  'README.md',
  'README.zh.md',
  'SUPPORT.md',
  'index.html',
  'package.json',
]
for (const path of publicRepositoryFiles) {
  const content = await readFile(join(root, path), 'utf8')
  check(
    !content.includes('https://github.com/dsh-external/dsh-vision-toolkit'),
    `${path} still links to the retired dsh-external repository`,
  )
}

await verifyWindowsCheckout()

const declaredEntrypoints = [
  pkg.main,
  pkg.types,
  pkg.exports?.['.']?.default,
  pkg.exports?.['.']?.types,
  pkg.exports?.['./client']?.default,
  pkg.exports?.['./client']?.types,
  pkg.dsh?.bundle?.patch,
]
for (const entrypoint of new Set(declaredEntrypoints.filter(value => typeof value === 'string'))) {
  check(await exists(resolve(root, entrypoint)), `declared package entrypoint is missing: ${entrypoint}`)
}

for (const markdownPath of ['README.md', 'README.zh.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'SECURITY.md', 'FUNDING.md', 'CHANGELOG.md', 'index.html']) {
  const absolute = join(root, markdownPath)
  const markdown = await readFile(absolute, 'utf8')
  for (const target of localTargets(markdown)) {
    check(await exists(resolve(dirname(absolute), target)), `${markdownPath} links to a missing local target: ${target}`)
  }
}

const imageExpectations = new Map([
  ['assets/hero.png', { width: 1600, height: 720 }],
  ['assets/social-preview.png', { width: 1280, height: 640 }],
])
for (const [path, expected] of imageExpectations) {
  const bytes = await readFile(join(root, path))
  const actual = pngDimensions(bytes)
  check(actual.width === expected.width && actual.height === expected.height, `${path} must be ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`)
}

const imageFiles = (await filesBelow(root)).filter(path => ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(path).toLowerCase()))
for (const path of imageFiles) {
  const info = await stat(path)
  check(info.size <= 2 * 1024 * 1024, `${relative(root, path)} exceeds the 2 MiB README image budget`)
}

const javascriptFiles = [
  ...await filesBelow(join(root, 'lib')),
  ...await filesBelow(join(root, 'scripts')),
].filter(path => ['.js', '.mjs'].includes(extname(path)))
for (const path of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', path], { cwd: root, encoding: 'utf8' })
  check(result.status === 0, `${relative(root, path)} failed node --check: ${(result.stderr || result.stdout).trim()}`)
}

const client = await readFile(join(root, 'lib/client.js'), 'utf8')
check(client.includes('window.__ModuleLoader__.load'), 'lib/client.js is not a loader-compatible DSH Web bundle')
const upstreamAdapter = await readFile(join(root, 'lib/upstream.js'), 'utf8')
check(upstreamAdapter.includes('--use-mock-keychain'), 'HTML screenshot adapter is missing --use-mock-keychain')
check(upstreamAdapter.includes('--user-data-dir='), 'HTML screenshot adapter is missing an isolated --user-data-dir')

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const pack = spawnSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  cwd: root,
  encoding: 'utf8',
})
if (pack.status !== 0) {
  failures.push(`npm pack --dry-run failed: ${(pack.stderr || pack.stdout).trim()}`)
} else {
  try {
    const result = JSON.parse(pack.stdout)
    const packedFiles = new Set((result[0]?.files ?? []).map(file => file.path))
    for (const path of ['lib/index.js', 'lib/types/index.d.ts', 'lib/client.js', 'cordis.patch.yml', 'assets/hero.png', 'assets/social-preview.png']) {
      check(packedFiles.has(path), `dry-run tarball is missing ${path}`)
    }
  } catch (error) {
    failures.push(`could not parse npm pack --json output: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`portable verification passed: ${requiredFiles.length} required files, ${javascriptFiles.length} JavaScript files, ${imageFiles.length} images\n`)
}
