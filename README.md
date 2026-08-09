# DSH Vision Toolkit

English | [中文](README.zh.md)

DSH Vision Toolkit (`@dsh-external/dsh-vision-toolkit`) gives a text-only
DeepSeek Harness agent structured eyes. It packages the upstream
[agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit)
algorithms behind six native DSH tools, a unified vision configuration with
DSH Credentials, and a bundled `vision-tools` skill — one install, one
lifecycle, no shell command splicing.

This is the P0 milestone: five core tools plus a version probe, structured
inputs and results, cancellation and timeout, path fencing, stable errors,
and tool/skill lifecycle tied to runtime readiness.

## Tools

| Tool | Purpose |
|---|---|
| `vision_glance` | Describe, answer a question about, OCR, or compare images in one call |
| `vision_ground` | Locate one named target and return original-image pixel boxes |
| `vision_detect` | Inventory every element of a kind with numbered pixel boxes |
| `vision_trace` | Recover clean, editable SVG geometry from a flat raster graphic |
| `vision_crop` | Cut a pixel box out of an image into its own PNG/JPEG file |
| `vision_toolkit_version` | Report plugin and pinned upstream version facts (read-only) |

The plugin never rewrites the vision algorithms: the runtime converts
structured requests into direct upstream Python invocations (no shell
interpolation), parses the upstream's stable output contracts, and returns
JSON to the model. Coordinates are pixel boxes (`x1/y1/x2/y2`) in the
original image and feed `vision_crop` unchanged.

## Install

The plugin is a profile bundle. From a DeepSeek Harness checkout, install it
into the profiles you use:

```sh
dsh plugin --profile web add /path/to/dsh-vision-toolkit
dsh plugin --profile headless add /path/to/dsh-vision-toolkit
```

Then configure the upstream runtime and vision provider (see below) and
restart the profile. `dsh --profile web --dump-config | grep vision-toolkit`
shows the mounted row.

The bundled `vision-tools` skill is registered at runtime only after the
upstream checkout passes the readiness check, and it is unregistered together
with the tools on disable/uninstall — the skill never advertises tools that
are not available.

## Configuration

Patch the profile row (same `id: vision-toolkit`) with your deployment:

```yaml
- update:
    - id: vision-toolkit
      config:
        provider:
          baseUrl: https://api.inferera.com/v1
          credential: VISION_API_KEY
          model: gemini-3.6-flash
        language: zh
        timeoutMs: 60000
        maxImageBytes: 10485760
        concurrency: 4
        runtime:
          mode: external
          agentVisionToolkitPath: /Users/me/agent-vision-toolkit
          python: python3
        allowedDirs: []
```

| Field | Default | Meaning |
|---|---|---|
| `provider.baseUrl` | `https://api.inferera.com/v1` | OpenAI-compatible vision service URL |
| `provider.credential` | `VISION_API_KEY` | DSH Credential reference holding the API key |
| `provider.model` | `gemini-3.6-flash` | Multimodal model name |
| `language` | `zh` | Vision output language (`zh` / `en`) |
| `timeoutMs` | `60000` | Per-call budget, 1000–600000 ms |
| `maxImageBytes` | `10485760` | Maximum accepted input image size |
| `concurrency` | `4` | In-flight tool executions per session, 1–16 |
| `runtime.mode` | `external` | P0 supports `external`; managed runtime is planned for P1 |
| `runtime.agentVisionToolkitPath` | probed | Upstream checkout; probed via `AGENT_VISION_TOOLKIT_PATH`, `~/.config/agent-vision-toolkit`, `~/.dsh/vision-toolkit/agent-vision-toolkit`, `~/agent-vision-toolkit` |
| `runtime.python` | `python3` | Python executable for upstream CLIs |
| `allowedDirs` | `[]` | Extra directories (besides the workspace) images may come from |

### Credentials

The API key is never stored in plugin configuration, logs, errors, or model
context. `provider.credential` is a DSH Credential reference resolved once
per tool call through `ctx.credentials` and injected only into the upstream
subprocess environment (`VISION_API_KEY`). Set it through the normal DSH
credential store:

```sh
dsh credentials set VISION_API_KEY
```

If an upstream `agent-vision-toolkit` env file exists (`~/.config/agent-vision-toolkit/env`, upstream `.env`, or `$PWD/.env`), its values win over the plugin config by upstream design; remove or empty those files so the plugin's unified configuration applies.

## Usage examples

```text
vision_glance images=["screenshot.png"] query="What error is shown?"
vision_ground image="screenshot.png" target="the send button"
vision_detect image="screenshot.png" category="buttons"
vision_crop image="screenshot.png" region="1067,841,1108,881"
vision_trace image="icon.png" color=true output="icon.svg"
```

A typical GUI workflow: `vision_ground` to locate a button, `vision_crop` to
cut the tight box to a file, then `vision_glance` with the same `region` to
read a detail, or `vision_trace` on the crop to recover geometry.

## Path and security model

- Inputs resolve against the session workspace and must stay inside it or an
  `allowedDirs` entry (realpath-checked; a symbolic link is allowed only when
  its target stays inside the fence).
- Outputs land in the workspace's `.dsh-vision-toolkit` directory; absolute
  paths, `..` segments, and wrong extensions are rejected.
- No base64 image payloads enter model context, session logs, or plugin logs;
  the tool result is text, numbers, coordinates, and file paths.
- Upstream stderr is redacted (API key replaced) before it reaches errors.

## Upstream version policy

The plugin pins
[agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) at
`v0.1.0` (`d194943f27bdb74dbee50760bc2c95f7d0f64fe7`, MIT license) and never
auto-fetches `main`. `vision_toolkit_version` reports the packaged pin and
the local checkout path. Upgrade the pin deliberately and run the full test
suite against the new checkout before bumping it.

## Development

```sh
node ../node_modules/typescript/bin/tsc -p tsconfig.json   # build (also: npm run build)
node ../node_modules/vitest/vitest.mjs run tests           # unit + integration
```

The plugin type-checks against the harness's built declarations and tests
against its sources through the root `tsconfig.base.json` facade; the
published package keeps bare package-name imports resolved by the host
profile fallback. The built `lib/` is committed so a Git checkout installs
without a build step.

## P0 scope and P1 roadmap

P0 ships: the standard bundle, six native tools, configuration and
credentials, cancellation/timeout/error classification, path fencing, the
bundled skill with tool/skill lifecycle, tests, bilingual docs, and clean
`DSH_HOME` install verification. P1 adds Artifact delivery, extended tools
(`pixel_diff`, long-screenshot OCR, foreground extraction, dominant colors,
HTML screenshots), dedicated web displays, health checks, settings, and the
managed runtime mode.

## License

MIT. The pinned upstream `agent-vision-toolkit` remains MIT-licensed and is
never vendored into this package — it is consumed as an external runtime at
the configured checkout.
