import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessService from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import type { PreparedUpstreamRuntime } from '../src/runtime-install.ts'
import { UpstreamAdapter } from '../src/upstream.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('HTML screenshot Chrome isolation guard', () => {
  it('uses a disposable profile and the mock keychain flag', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-vt-html-guard-'))
    roots.push(root)
    const scriptDir = join(root, 'skills', 'vision-tools', 'scripts')
    const cleanHome = join(root, 'home')
    const capture = join(root, 'chrome-args.json')
    const fakeChrome = join(root, 'fake-chrome')
    await mkdir(scriptDir, { recursive: true })
    await mkdir(cleanHome, { recursive: true })
    await writeFile(fakeChrome, [
      '#!/usr/bin/env python3',
      'import base64,json,sys',
      'from pathlib import Path',
      `capture=Path(${JSON.stringify(capture)})`,
      'args=sys.argv[1:]',
      'capture.write_text(json.dumps(args),encoding="utf-8")',
      'output=next(value.split("=",1)[1] for value in args if value.startswith("--screenshot="))',
      'png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="',
      'Path(output).write_bytes(base64.b64decode(png))',
      '',
    ].join('\n'))
    await chmod(fakeChrome, 0o755)
    await writeFile(join(scriptDir, 'html_shot.py'), [
      'import subprocess,sys',
      `chrome=${JSON.stringify(fakeChrome)}`,
      'source=sys.argv[1]',
      'args=sys.argv[2:]',
      'output=args[args.index("-o")+1]',
      'command=[chrome,"--headless=new",f"--screenshot={output}",source]',
      'result=subprocess.run(command,text=True,capture_output=True)',
      'if result.returncode != 0: raise SystemExit(result.returncode)',
      'print(f"wrote {output} (1x1)")',
      '',
    ].join('\n'))
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessService)
    const config = resolveConfig({ runtime: { mode: 'managed' } })
    const prepared: PreparedUpstreamRuntime = {
      source: 'managed',
      root,
      python: { program: 'python3', prefix: [], display: 'python3' },
      cleanHome,
      pythonVersion: '3.11+',
      dependencies: {},
    }
    const adapter = new UpstreamAdapter(ctx, config, prepared)
    const output = join(root, 'shot.png')
    const result = await adapter.run('html_screenshot', [
      join(root, 'page.html'),
      '-o', output,
      '--width', '1',
      '--height', '1',
      '--scale', '1',
      '--wait-ms', '0',
    ], { signal: new AbortController().signal })

    expect(result.outcome.exitCode).toBe(0)
    expect(existsSync(output)).toBe(true)
    const args = JSON.parse(await readFile(capture, 'utf8')) as string[]
    expect(args).toContain('--use-mock-keychain')
    expect(args).toContain('--incognito')
    expect(args).toContain('--disable-background-networking')
    const profileArg = args.find(value => value.startsWith('--user-data-dir='))
    expect(profileArg).toMatch(/^--user-data-dir=.*dsh-vision-chrome-/)
    const profile = profileArg?.slice('--user-data-dir='.length)
    expect(profile).toBeDefined()
    expect(existsSync(profile ?? '')).toBe(false)
  })
})
