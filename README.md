# DSH Vision Toolkit

English | [中文](README.zh.md)

DSH Vision Toolkit (`@dsh-external/dsh-vision-toolkit`) gives text-only DeepSeek Harness agents structured vision engineering capabilities. One profile-bundle install provides native tools, DSH Credentials integration, a reproducible Python runtime, and the matching `vision-tools` skill without shell command construction or a DSH Core change.

The current P0 surface contains five capability tools plus a read-only version probe, structured inputs and results, operation-wide cancellation and timeout, decoded-image limits, session-scoped concurrency, path fencing, stable errors, and atomic tool/skill lifecycle.

## Tools

| Tool | Purpose |
|---|---|
| `vision_glance` | Describe, answer a question about, OCR, or compare images in one call |
| `vision_ground` | Locate one named target and return original-image pixel boxes |
| `vision_detect` | Inventory every element of a kind with numbered pixel boxes |
| `vision_trace` | Recover editable SVG paths from a flat raster graphic with upstream vtracer |
| `vision_crop` | Cut a pixel box out of an image into its own PNG/JPEG file |
| `vision_toolkit_version` | Report plugin, upstream snapshot, Python, and dependency versions without a vision API call |

The plugin does not reimplement visual algorithms. It converts structured requests into direct argv-based calls to the pinned `agent-vision-toolkit` scripts, validates their output contracts, and returns JSON to the model. Grounding coordinates are original-image pixel boxes (`x1/y1/x2/y2`) that can be passed directly to `vision_crop`.

## Requirements

- DeepSeek Harness with the Web or Headless profile.
- Python 3.11 or newer. The default managed mode creates an isolated environment; users do not install the upstream CLI or Python packages manually.
- Network access to install the exact packages in `runtime/requirements.lock` on the first managed-runtime activation. A valid cached runtime is reused on later starts.
- An OpenAI-compatible vision endpoint and DSH Credential for `vision_glance`, `vision_ground`, and `vision_detect`. Local `vision_crop`, `vision_trace`, and version inspection do not resolve a credential.

## Install

Install the bundle into each profile that should expose the tools:

```sh
dsh plugin --profile web add /path/to/dsh-vision-toolkit
dsh plugin --profile headless add /path/to/dsh-vision-toolkit
```

Confirm the patch row with `dsh --profile web --dump-config | grep vision-toolkit`, configure the provider Credential, and restart the profile. The first managed start verifies the packaged upstream manifest and atomically prepares the isolated Python environment under `DSH_HOME/cache/dsh-vision-toolkit`; an interrupted upgrade leaves the previous completed runtime intact.

The plugin registers tools only after runtime preparation succeeds, then mounts the matching `vision-tools` skill. Preparation failure leaves neither tools nor skill registered; disable or disposal removes both.

## Configuration

The bundle defaults to the managed runtime, so most installations only patch the provider:

```yaml
- id: vision-toolkit
  config:
    provider:
      baseUrl: https://api.inferera.com/v1
      credential: VISION_API_KEY
      model: gemini-3.6-flash
    language: zh
    timeoutMs: 60000
    maxImageBytes: 10485760
    maxImagePixels: 40000000
    concurrency: 4
    runtime:
      mode: managed
    allowedDirs: []
```

| Field | Default | Meaning |
|---|---|---|
| `provider.baseUrl` | `https://api.inferera.com/v1` | OpenAI-compatible vision service URL |
| `provider.credential` | `VISION_API_KEY` | DSH Credential reference holding the API key |
| `provider.model` | `gemini-3.6-flash` | Multimodal model name |
| `language` | `zh` | Vision output language (`zh` / `en`) |
| `timeoutMs` | `60000` | Whole-operation hard deadline, 1000–600000 ms |
| `maxImageBytes` | `10485760` | Maximum encoded size for each input image |
| `maxImagePixels` | `40000000` | Maximum decoded pixel count for each input image |
| `concurrency` | `4` | In-flight executions per session, 1–16 |
| `runtime.mode` | `managed` | `managed` uses the packaged snapshot and isolated environment; `external` accepts only the exact pin |
| `runtime.agentVisionToolkitPath` | unset | Required only in `external` mode; must be an exact exported snapshot or a clean checkout at the pinned commit |
| `runtime.python` | unset | Optional Python 3.11+ bootstrap/interpreter override |
| `allowedDirs` | `[]` | Extra directories, besides the session workspace, from which images may be read |

### External runtime mode

External mode is for development or controlled deployments that already provide the exact supported upstream source:

```yaml
- id: vision-toolkit
  config:
    runtime:
      mode: external
      agentVisionToolkitPath: /opt/agent-vision-toolkit
      python: python3.12
```

The path must be either an exported copy whose `UPSTREAM_MANIFEST.json` and complete file set match the package or the root of a clean Git checkout at `c27d1a300962b553c0884993c575cd3e819465ce`. Modified tracked files and untracked files are rejected because they could change or shadow the pinned Python behavior.

### Credentials

The API key is never stored in plugin configuration, model context, Artifact metadata, logs, or model-facing errors. `provider.credential` is resolved through `ctx.credentials` only for remote tools and injected only into their subprocess environment:

```sh
dsh credentials set VISION_API_KEY
```

Upstream commands run with an isolated home/current directory and an explicit non-existent env-file location, so user-level `agent-vision-toolkit` env files and checkout `.env` files cannot override the DSH provider configuration. Ambient `PYTHONPATH`, `PYTHONHOME`, `VIRTUAL_ENV`, and user-site packages are also excluded.

## Usage examples

```text
vision_glance images=["screenshot.png"] query="What error is shown?"
vision_ground image="screenshot.png" target="the send button"
vision_detect image="screenshot.png" category="buttons"
vision_crop image="screenshot.png" region="1067,841,1108,881"
vision_trace image="icon.png" color=true output="icon.svg"
```

A common GUI workflow is `vision_ground` → `vision_crop` → `vision_glance` or `vision_trace`. Identical resolved image paths inside one `vision_glance` request are sent only once.

## Path and security model

- Inputs resolve against the session workspace and must remain inside it or a configured `allowedDirs` root after realpath resolution; a symbolic link is allowed only when its target stays inside the fence.
- Pillow decodes every image before any remote request; encoded bytes, decoded pixels, dimensions, and filename/content format agreement are enforced.
- Outputs land in `<workspace>/.dsh-vision-toolkit/artifacts`. Users may select one filename, but absolute paths, nested paths, traversal, and unsupported extensions are rejected.
- Upstream writes to a random staging path in the real output directory. The plugin verifies the staged regular file before committing it, so a pre-existing destination symlink cannot redirect the upstream write.
- Ground/detect output is accepted only when every non-empty line matches the pinned coordinate grammar and every box lies inside the original image.
- No image base64 enters model context, session logs, or plugin logs. Logs contain bounded metrics only; stderr and failures redact resolved credentials.

## Upstream version policy

The package contains an MIT-licensed source snapshot of [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) at `v0.1.0+snapshot.c27d1a3` (`c27d1a300962b553c0884993c575cd3e819465ce`). `vendor/agent-vision-toolkit/UPSTREAM_MANIFEST.json` records every source file and SHA-256; build, runtime preparation, and external-mode validation fail if the pin changes unexpectedly. The plugin never fetches upstream `main` at runtime.

Upgrade the snapshot only through `npm run upstream:sync -- <checkout>`, inspect the resulting source and license, regenerate the manifest, and run the compatibility tests before committing the pin and generated `lib/` together.

## Development

```sh
pnpm run build
pnpm test
pnpm pack --dry-run
```

`pnpm run build` first verifies the vendored manifest and then emits JavaScript and declarations. The committed `lib/` allows installation from a Git checkout without a consumer-side build.

## P0 scope and P1 roadmap

P0 ships the standard bundle, managed/external pinned runtime, six native tools, DSH Credentials, cancellation/timeout/error classification, byte and pixel limits, path fencing, atomic output staging, session-scoped concurrency, the lifecycle-coupled skill, tests, bilingual documentation, and clean-`DSH_HOME` profile verification. P1 adds Artifact descriptors and delivery routes, extended tools (`pixel_diff`, long-screenshot OCR, foreground extraction, dominant colors, HTML screenshots), dedicated Web displays, health checks, Settings, and an end-to-end UI reconstruction example.

## License

The plugin is MIT-licensed. The packaged `agent-vision-toolkit` snapshot retains its upstream MIT license in `vendor/agent-vision-toolkit/LICENSE` and remains the sole implementation of its visual algorithms.
