import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const compiledRoot = join(root, '.client-build')
const outputPath = join(root, 'lib', 'client.js')
const compiledFiles = (await readdir(compiledRoot))
  .filter(path => path.endsWith('.js'))
  .sort((a, b) => a.localeCompare(b))

const lines = [
  'window.__ModuleLoader__.load({ id: "@dsh-external/dsh-vision-toolkit", factory: (require) => {',
  'var __modules = Object.create(null); var __cache = Object.create(null);',
]
const sections = []
for (const filename of compiledFiles) {
  const moduleId = `./${filename}`
  const compiledPath = join(compiledRoot, filename)
  const source = (await readFile(compiledPath, 'utf8'))
    .replace(/\n?\/\/# sourceMappingURL=.*$/u, '')
    // Keep host package imports on `require`, but route compiler-emitted local
    // CommonJS imports through the private module table. `__load_` has the
    // same width as `require`, so the sectioned source maps remain aligned.
    .replace(/\brequire(?=\(["']\.\.?\/)/gu, '__load_')
  lines.push(`__modules[${JSON.stringify(moduleId)}] = function(module, exports, require, __load_) {`)
  sections.push({
    offset: { line: lines.length, column: 0 },
    map: JSON.parse(await readFile(`${compiledPath}.map`, 'utf8')),
  })
  lines.push(source, '};')
}
lines.push(
  'function __resolve(from, request) {',
  '  if (!request.startsWith(".")) return request;',
  '  var parts = from.slice(2).split("/"); parts.pop();',
  '  for (var part of request.split("/")) { if (part === "." || part === "") continue; if (part === "..") parts.pop(); else parts.push(part); }',
  '  return "./" + parts.join("/");',
  '}',
  'function __load(id) {',
  '  if (__modules[id] === undefined) return require(id);',
  '  if (__cache[id] !== undefined) return __cache[id].exports;',
  '  var module = __cache[id] = { exports: {} };',
  '  __modules[id](module, module.exports, require, function(request) { var resolved = __resolve(id, request); return __modules[resolved] === undefined ? require(request) : __load(resolved); });',
  '  return module.exports;',
  '}',
  'return __load("./index.js"); } });',
  '//# sourceMappingURL=client.js.map',
  '',
)
const wrapped = lines.join('\n')

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, wrapped)

for (const section of sections) {
  section.map.file = 'client.js'
  section.map.sources = section.map.sources.map(sourcePath => `../src/client/${sourcePath.replace(/^\.\.\//u, '')}`)
}
await writeFile(`${outputPath}.map`, `${JSON.stringify({ version: 3, file: 'client.js', sections })}\n`)
await rm(compiledRoot, { recursive: true, force: true })
