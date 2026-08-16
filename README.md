<p align="center">
  <img src="assets/hero-v2.png" alt="DSH Vision Toolkit — native visual engineering for text-only DeepSeek Harness agents" />
</p>

<h1 align="center">DSH Vision Toolkit</h1>

<p align="center">
  English | <a href="https://github.com/Anionex/dsh-vision-toolkit/blob/main/README.zh.md">中文</a>
</p>

<p align="center">
  <a href="https://dshfind.com/en/plugins/Anionex/dsh-vision-toolkit"><img src="https://img.shields.io/badge/recommended%20by-dshfind-FFD700?style=flat-square" alt="Recommended by dshfind" /></a>
  <a href="https://dshfind.com/en/plugins/Anionex/dsh-vision-toolkit"><img src="https://img.shields.io/badge/dshfind%20score-94%20%7C%20highest--rated%20plugin-5B4CF0?style=flat-square" alt="dshfind score: 94 — highest-rated plugin" /></a>
  <a href="https://x.com/anion_ex"><img src="https://img.shields.io/badge/-@anion__ex-000000?style=flat-square&amp;logo=x&amp;logoColor=white" alt="X: @anion_ex" /></a>
  <a href="https://github.com/Anionex/dsh-vision-toolkit/releases/tag/v0.1.12"><img src="https://img.shields.io/badge/release-v0.1.12-5B4CF0?style=flat-square" alt="Release v0.1.12" /></a>
  <a href="tests"><img src="https://img.shields.io/badge/verified-233%20tests-2EA44F?style=flat-square" alt="Verified: 233 tests" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0B7285?style=flat-square" alt="License: MIT" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%5E22.19%20%7C%20%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js ^22.19 or >=24" /></a>
  <a href="runtime/requirements.lock"><img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&amp;logo=python&amp;logoColor=white" alt="Python 3.11+" /></a>
  <a href="cordis.patch.yml"><img src="https://img.shields.io/badge/DSH-Web%20%2B%20Headless-5B4CF0?style=flat-square" alt="DSH Web and Headless profiles" /></a>
</p>

## Give your DSH agent eyes

Drop in a screenshot and let a text-only DeepSeek Harness agent inspect it, read it, locate elements, extract assets, rebuild interfaces, and measure whether the result matches.

DSH Vision Toolkit packages [`agent-vision-toolkit`](https://github.com/Anionex/agent-vision-toolkit) as a native DSH plugin. You get focused image Q&A, OCR, original-pixel coordinates, UI restoration, pixel comparison, downloadable results, and a Web Settings panel without assembling scripts by hand.

```sh
dsh plugin --profile web add @anionex/dsh-vision-toolkit
```

The npm package includes the visual toolkit snapshot and uses a managed runtime by default. **Normal installation does not require a source checkout or an `agentVisionToolkitPath`.**

**Upstream toolkit:** [Anionex/agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) · **Project website:** [agent-vision.anionex.me](https://agent-vision.anionex.me)

## What you can do

| Goal | What the agent can deliver |
|---|---|
| Understand a screenshot | Focused answers, visual descriptions, multi-image comparison, and OCR |
| Find an interface element | Original-image pixel coordinates with an optional labeled preview |
| Rebuild a page from a reference | Screenshot rendering, region-by-region diagnosis, and measurable iteration |
| Extract a usable asset | Cropped images, transparent foregrounds, dominant colors, or editable SVG |
| Read a long screenshot | Auditable chunks, Markdown output, manifests, and resumable OCR runs |
| Verify a visual result | A difference percentage, ranked mismatch regions, heatmap, and JSON report |

You can use remote vision only where it adds value. Cropping, tracing, pixel comparison, color analysis, foreground extraction, and HTML screenshots run locally.

## See it in action

The first example is a live DSH Web view. The next two examples come from the same `agent-vision-toolkit` lineage packaged with this plugin, and the last shows the workflow inside a live DeepSeek Harness Web session. See the [asset provenance record](assets/upstream/README.md) for source details.

### DSH view example

<p align="center">
  <img src="assets/dsh-view-example.png" width="80%" alt="DSH Web session view in which a text-only DeepSeek-V4-Flash (Vision Toolkit) model answers a question about a pasted banner image." />
</p>

*A live DSH Web view: the user pastes a brand-banner screenshot, and the text-only model answers what the image contains through the `DeepSeek-V4-Flash (Vision Toolkit)` image-input variant.*

### Infographic restoration: screenshot to editable HTML/CSS

<p align="center">
  <img src="assets/upstream/infographic-reference.webp" width="49%" alt="Upstream reference screenshot of a three-stage model-training infographic." />
  <img src="assets/upstream/infographic-result.webp" width="49%" alt="Upstream editable HTML and CSS reconstruction of the model-training infographic." />
</p>

*Left: source screenshot. Right: the editable HTML/CSS result from the upstream [infographic-restoration reference](https://github.com/Anionex/agent-vision-toolkit/blob/c27d1a300962b553c0884993c575cd3e819465ce/examples/infographic-restoration/how-is-the-model-trained.html).*

### UI restoration: sketch to working interface

<p align="center">
  <img src="assets/upstream/ui-sketch.webp" width="49%" alt="Upstream hand-drawn JupyterLab workspace used as a UI restoration reference." />
  <img src="assets/upstream/ui-result.webp" width="49%" alt="Upstream JupyterLab-style working interface reconstructed from the hand-drawn reference." />
</p>

*Left: hand-drawn input. Right: the upstream reconstructed interface; the complete method lives in the [UI restoration playbook](https://github.com/Anionex/agent-vision-toolkit/blob/c27d1a300962b553c0884993c575cd3e819465ce/skills/vision-tools/references/restore-ui.md).*

### Image Q&A and screenshot-guided debugging

<p align="center">
  <img src="assets/dsh-conversation-image-qa.png" width="49%" alt="DSH Web session in which a text-only agent answers a focused question about a UI reference image." />
  <img src="assets/dsh-conversation-screenshot-debugging.png" width="49%" alt="DSH Web session in which the agent uses a screenshot comparison to diagnose mismatched UI fields and recommend vision_pixel_diff." />
</p>

*Left: intent-aware image Q&A in DSH Web. Right: a DSH Web screenshot-debugging turn that lists the concrete UI differences and continues toward `vision_pixel_diff`. The upstream workflow source is the same [`agent-vision-toolkit` reference](https://github.com/Anionex/agent-vision-toolkit/blob/c27d1a300962b553c0884993c575cd3e819465ce/README.md#real-world-effects).*

DSH Vision Toolkit brings this workflow into DSH, where the result can become a file, a coordinate, a measured comparison, or the next step in the same session.

## From a rough match to pixel-perfect

The included UI-restoration workflow starts with an intentionally inaccurate HTML implementation. Vision Toolkit measures a `6.04%` difference, points to the worst regions, and helps drive the next iteration. The final render reaches an exact `0%` difference at `1200 × 720`.

<p>
  <img src="examples/ui-restoration/assets/initial.png" width="49%" alt="Initial UI restoration candidate before Vision Toolkit iteration, with measurable layout and styling differences from the reference." />
  <img src="examples/ui-restoration/assets/implementation.png" width="49%" alt="Final UI restoration output reproduced by the checked-in workflow with zero pixel difference from the reference." />
</p>

| Start | Result |
|---|---|
| Reference image | A working HTML implementation you can open and edit |
| First comparison | `6.04%` difference across the visible problem regions |
| Final comparison | `0%` difference at `1200 × 720` |

## Why it feels different

- **Ask for the thing you need.** “Where is the submit button?” and “Why does this screenshot differ from the reference?” lead to focused visual work instead of a generic caption.
- **Get evidence you can use.** The agent returns coordinates, OCR, measurements, JSON, and files you can open or pass to the next step.
- **Keep the workflow in DSH.** Credentials, Settings, Artifacts, Web cards, and Headless results live alongside the rest of your session.
- **Use local tools when you can.** Crop, trace, pixel comparison, color analysis, foreground extraction, and HTML screenshots do not consume a vision API request.
- **Repeat the loop.** Reference image → implementation → screenshot → pixel diff gives UI work a measurable finish line.

## Start in three steps

Use DeepSeek Harness `0.1.0-rc.6` or a compatible later `0.1.x` release. The plugin prepares its managed runtime on first use.

```sh
dsh plugin --profile web add @anionex/dsh-vision-toolkit
dsh plugin --profile headless add @anionex/dsh-vision-toolkit
```

1. Restart your Web profile and open **Settings → Vision Toolkit**.
2. New installations use the built-in free Gemma 4 provider, so you can run **Test API connection** and **Test vision model** without an API key. To use another provider, edit the endpoint/model/protocol and provide its DSH Credential.
3. In a conversation, paste an image or put it in the workspace, invoke `/vision-tools`, and ask for a concrete visual task.

If you use an older DSH launcher, the profile may need `nodeLinker: hoisted` and `autoInstallPeers: false` before installation. Current launchers repair these settings for you.

Local crop, trace, pixel, color, foreground, and HTML operations do not require a visual API credential.

## Community Group

Join the `agent-vision-toolkit` community group to exchange usage tips, share feedback, and suggest improvements.

<p align="center">
  <img src="assets/community-group-qr.png" alt="QR code for the agent-vision-toolkit community group" width="260">
</p>

> **No local path is required.** Keep the default `runtime.mode: managed` for the normal npm installation. The optional `runtime.agentVisionToolkitPath` setting is only for developers or controlled deployments that deliberately use an external pinned checkout.

<details>
<summary><strong>Technical architecture</strong></summary>

## How it works

```mermaid
flowchart LR
    User["Workspace image or local HTML"] --> Skill["vision-tools Skill"]
    Skill --> Activate["Agent-scoped activation"]
    Activate --> Tools["10 independent vision_* tools"]
    Tools --> Runtime["Shared VisionToolkitRuntime"]
    Credentials["DSH Credentials"] --> Runtime
    Settings["Web Settings and health"] --> Runtime
    Runtime --> Upstream["Pinned agent-vision-toolkit"]
    Runtime --> Remote["Configured vision API"]
    Upstream --> Result["Text, coordinates, JSON"]
    Remote --> Result
    Runtime --> Artifacts["Workspace Artifacts"]
    Result --> Session["Reconstructable Session log"]
    Artifacts --> Web["Preview, download, or open file"]
```

Tool definitions call one runtime; the runtime validates paths, limits, credentials, cancellation, and deadlines before dispatching to the pinned upstream snapshot or configured vision provider endpoint. Web presentation consumes the same structured results and Artifact descriptors, so it does not change Headless behavior. Health, connection testing, and version inspection stay in Settings rather than model tool schemas.

</details>

## Tools

| Tool | Execution | Structured result | Artifact delivery |
|---|---|---|---|
| `vision_glance` | Remote vision API | Description, targeted answer, OCR, or multi-image comparison | None |
| `vision_ground` | Remote vision API; optional local preview | Target, original-image dimensions, and pixel boxes | Optional labeled PNG |
| `vision_detect` | Remote vision API; optional local preview | Numbered element inventory and original-image pixel boxes | Optional numbered PNG |
| `vision_trace` | Local pinned vtracer pipeline | SVG geometry status, path count, scale, and size | SVG |
| `vision_crop` | Local Pillow pipeline | Applied pixel box, dimensions, format, and clamp status | PNG or JPEG |
| `vision_pixel_diff` | Local NumPy/Pillow pipeline | Difference percentage and ranked grid regions | PNG heatmap and JSON report |
| `vision_long_screenshot_ocr` | Local split/audit; remote OCR unless `splitOnly=true` | Chunk boundaries, reuse state, completion state, and run directory | Markdown, manifest, boundary audit, chunk PNGs, and OCR sidecars |
| `vision_extract_foreground` | Local pinned extraction pipeline | Selected box, component counts, foreground coverage, and dimensions | Transparent PNG |
| `vision_dominant_colors` | Local pinned color analysis | Extracted palette or pixel-backed candidate ranking | None |
| `vision_html_screenshot` | Local Chrome/Chromium/Edge adapter | Authorized source facts, viewport, and rendered dimensions | PNG |

The plugin does not reimplement visual algorithms. Its DSH-owned layer validates paths and limits, resolves credentials, calls the pinned upstream scripts with argv vectors, parses their exact output contracts, classifies failures, describes files, and projects results to the model and Web client.

<details>
<summary><strong>Advanced model behavior</strong></summary>

## Progressive model exposure

Runtime readiness is profile-wide, but the ten visual execution schemas are Agent-scoped. Before an Agent loads `vision-tools`, the plugin contributes only the small `vision_toolkit_activate` bootstrap; the visual tools are absent from that Agent's request schema. A successful call to the standard `skill` tool with `name="vision-tools"` mounts all ten tools automatically for the next model step and hides the bootstrap. A direct `/vision-tools` invocation injects the Skill instructions; if the visual tools are still absent, those instructions require one `vision_toolkit_activate` call. Activation affects only that Agent, restores when the Session contains durable evidence matching the bundled Skill version, and lasts until the Agent or plugin is disposed.

Health checks, connection testing, and plugin/upstream version inspection are administrative Web Settings operations. `vision_toolkit_health` and `vision_toolkit_version` are not model tools and never enter an Agent's schema, including after visual-tool activation.

## Image-input variants for text-only models

Text-only model routes get sibling model-selector entries named `<model> (Vision Toolkit)` under a matching provider group. DSH cannot pass a pasted attachment's local path through its native image block, so every bridge path materializes the image inside the session workspace and exposes its absolute path to the model. The model can then call `vision_glance` (or another visual tool) with that path. When the server-side image-input variant is active, the same model-visible block also contains the focus-hinted `[vision model description]` evidence aligned with `agent-vision-toolkit`; the path remains available for a second, more targeted visual call. The session log contains the durable path reference and the UI keeps the paste record.

A variant is registered automatically for every model the host positively declares text-only (for example the DeepSeek chat family). With the default `autoSwitch: true`, the browser switches to `<model> (Vision Toolkit)` and the server-side bridge rewrites each native image block into **both** the workspace path and the focus-hinted description; the path is not hidden from the model. Setting `autoSwitch: false` keeps the older path-only takeover instead. The host's verdict uses the exact model route the browser read from the live model catalog, with the selector label as fallback; unconfirmed or image-capable routes keep their native flow.

Description conversion needs the configured vision provider and its credential when the opt-in image-input variant is used; when the runtime is not ready or a read fails, the wire block keeps the workspace path and adds the upstream-compatible `[vision unavailable: ...]` note instead of failing the turn. The bridge does not treat injected context files as the current user intent, and it uses the latest assistant paragraph when a tool-fetched image is being described. Disable variants with `imageInputVariants.enabled: false`, restrict the wrapped routes with `imageInputVariants.providers`, or opt into native attachment switching with `imageInputVariants.autoSwitch: true`.

</details>

## Requirements

- DeepSeek Harness with a Web or Headless profile and `pnpm` available to `dsh plugin`.
- Python 3.11 or newer. Managed mode creates an isolated environment, so users do not install the upstream CLI or Python packages manually.
- Network access on the first managed-runtime activation unless the exact packages in `runtime/requirements.lock` are already available in the configured package cache.
- The built-in free Gemma 4 provider is ready for `vision_glance`, `vision_ground`, `vision_detect`, and non-split-only long-screenshot OCR. A DSH Credential is required only when a custom OpenAI-compatible or Anthropic endpoint is configured. Local tools remain usable without either provider.
- Chrome, Chromium, or Edge only for `vision_html_screenshot`; all other tools remain available when no supported browser is installed.
- PNG, JPEG, GIF, or WebP inputs inside the session workspace or an explicitly configured `allowedDirs` root.

## Install and lifecycle

### Install

Install the bundle into each profile that should expose it:

```sh
dsh plugin --profile web add @anionex/dsh-vision-toolkit
dsh plugin --profile headless add @anionex/dsh-vision-toolkit
dsh --profile web --dump-config | grep vision-toolkit
dsh --profile headless --dump-config | grep vision-toolkit
```

Restart a long-lived Web profile after installation. The host discovers the built browser bundle from `package.json`'s `dsh.client` declaration at process startup; the legacy top-level `dshClient` field is not scanned.

The first managed start verifies the packaged upstream manifest and atomically prepares an isolated environment under `DSH_HOME/cache/dsh-vision-toolkit`. Only after preparation succeeds does the plugin publish the same-version `vision-tools` Skill and activation bootstrap; each Agent receives the execution tools only after loading that Skill. An initial preparation failure leaves the Web Settings repair surface available but exposes neither model capability nor a misleading Skill.

### Disable and re-enable

Set the bundle row to `disabled: true` in a profile patch or overlay:

```yaml
- id: vision-toolkit
  disabled: true
```

Remove the flag or set it to `false` to re-enable the plugin. Disposal first cancels plugin-owned visual operations, then removes every Agent-scoped tool, the bootstrap, and the Skill; reactivation prepares the configured runtime before any model capability becomes visible. User configuration and completed Artifacts remain intact.

### Upgrade

**Migrating from the retired `@dsh-external/dsh-vision-toolkit`:** the npm package now lives under the `@anionex` scope. If you installed the retired package, do **not** run `update` on it — that account cannot publish this release. Migrate to the new package name and restart the Web profile:

```sh
dsh plugin --profile web remove @dsh-external/dsh-vision-toolkit
dsh plugin --profile web add @anionex/dsh-vision-toolkit
```

After restarting, Settings → Vision should report plugin version **0.1.12**. The built-in free provider is selected automatically; custom providers still use the configured DSH Credential.

For a registry installation, update the dependency through the profile package manager:

```sh
dsh plugin --profile web update @anionex/dsh-vision-toolkit
dsh plugin --profile headless update @anionex/dsh-vision-toolkit
```

For a local path installation, run `add` again against the replacement checkout or tarball. Settings remain in the profile's Settings provider. A candidate runtime is fully validated and prepared before it is persisted and made active; a failed or obsolete concurrent candidate cannot replace the current serving generation.

### Uninstall

```sh
dsh plugin --profile web remove @anionex/dsh-vision-toolkit
dsh plugin --profile headless remove @anionex/dsh-vision-toolkit
```

`dsh plugin remove` removes both the dependency and its bundle layer. The profile no longer exposes the activation bootstrap, Agent-scoped Vision Toolkit tools, or Skill entries. Managed cache data may be deleted separately when no profile uses the package; it is not active configuration and cannot register anything by itself.

## Configure

The bundle defaults to the managed runtime. A profile patch can override the provider and limits:

```yaml
- id: vision-toolkit
  config:
    provider:
      baseUrl: https://vision.anionex.me/v1
      credential: ANIONEX_FREE_VISION
      model: gemma-4-26b-a4b-it
      protocol: openai
      anthropicThinking: omit
      userAgent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36
    language: zh
    timeoutMs: 60000
    maxImageBytes: 4194304
    maxImagePixels: 20000000
    concurrency: 4
    runtime:
      mode: managed
    allowedDirs: []
    imageInputVariants:
      enabled: true
      providers: []
      autoSwitch: true
```

### Configuration fields

| Field | Default | Contract |
|---|---|---|
| `provider.baseUrl` | `https://vision.anionex.me/v1` | Built-in free OpenAI-compatible endpoint; custom providers may use another base URL, normalized without trailing slashes |
| `provider.credential` | `ANIONEX_FREE_VISION` | Read-only built-in reference for the free service; custom providers use a DSH Credential reference, never a secret value |
| `provider.model` | `gemma-4-26b-a4b-it` | Multimodal model name sent to remote tools |
| `provider.protocol` | `openai` | `openai` sends Chat Completions requests; `anthropic` sends native Messages requests |
| `provider.anthropicThinking` | `omit` | Anthropic thinking field. `omit` sends no thinking field and has the broadest compatibility. Use `disabled` or `adaptive` only when the selected model documents that mode; restore `omit` first if the provider returns HTTP 400. |
| `provider.userAgent` | browser-compatible default | User-Agent sent by vision requests and explicit connection tests; override it for provider or proxy compatibility |
| `language` | `zh` | Vision output language: `zh` or `en` |
| `timeoutMs` | `60000` | Whole-operation deadline, 1000-600000 ms; each tool may request a narrower override |
| `maxImageBytes` | `4194304` | Encoded-byte limit per input image; the built-in free service accepts up to 4 MiB |
| `maxImagePixels` | `20000000` | Decoded-pixel limit per input image; the built-in free service accepts up to 20,000,000 pixels |
| `concurrency` | `4` | In-flight operations per session, 1-16 |
| `runtime.mode` | `managed` | `managed` uses the packaged snapshot; `external` accepts only the exact pin |
| `runtime.agentVisionToolkitPath` | unset | Required in `external` mode; exported exact snapshot or clean pinned Git checkout |
| `runtime.python` | unset | Optional Python 3.11+ bootstrap/interpreter override |
| `allowedDirs` | `[]` | Additional realpath-resolved input roots; the session workspace is always allowed |
| `imageInputVariants.enabled` | `true` | Register image-input variant entries for text-only model routes in the model selector |
| `imageInputVariants.providers` | `[]` | Restrict wrapped upstream routes by provider id; empty wraps every eligible route |
| `imageInputVariants.autoSwitch` | `true` | Automatically switch a text-only session to its image-input variant; the model receives both the workspace path and focused description. `false` keeps the path-only takeover |

### Credentials

The built-in free provider uses the fixed `ANIONEX_FREE_VISION` reference and does not accept or store a user API key. If you change the endpoint, model, or protocol to a custom provider, the write-only **API key** field unlocks; saving a non-empty value writes it under the advanced **Credential name** reference. Headless deployments can pre-provision that custom reference in `$DSH_HOME/.credentials.yaml`.

Settings store only the reference, never the value. The browser does not receive a stored value, and a successful save clears the field instead of echoing it. Remote operations resolve the reference once per call and inject the value only into that subprocess environment. The plugin excludes user `.env` files, checkout `.env` files, `PYTHONPATH`, `PYTHONHOME`, `VIRTUAL_ENV`, and user site-packages so ambient Python or upstream configuration cannot override the selected DSH provider. Logs, errors, tool results, Artifact metadata, and Settings responses never contain the secret.

### Built-in free service limits

The public service is shared and intended as a zero-configuration default, not an unlimited private endpoint. Limits are enforced by the proxy and returned as OpenAI-style errors with a reason code and readable message; rate-limit responses also include `Retry-After` and request-quota headers.

| Limit | Current value |
|---|---:|
| Per client | 100 requests per UTC day |
| Global service | 400 requests per UTC day |
| Burst | 20 requests per 60 seconds |
| Image bytes | 4 MiB per image |
| Decoded pixels | 20,000,000 per image |
| Output | 512 tokens maximum |

### Managed runtime and optional external runtime

Managed mode verifies `vendor/agent-vision-toolkit/UPSTREAM_MANIFEST.json`, prefers `uv`, falls back to `venv` plus pip, installs exact versions from `runtime/requirements.lock`, coordinates concurrent preparation with a heartbeat lock, and publishes a staged environment only after all probes pass.

Most users should stop at managed mode. It is included in the npm package and prepares the pinned Python environment for you.

The optional external mode is for plugin development or controlled deployments that already maintain the exact upstream checkout:

```yaml
- id: vision-toolkit
  config:
    runtime:
      mode: external
      agentVisionToolkitPath: /opt/agent-vision-toolkit
      python: python3.12
```

The path must be an exported copy matching the packaged manifest or the root of a clean Git checkout at `bc9803d7d6300c864d17460ecbb33540b26638e0`. Modified tracked files and untracked files are rejected because they can change or shadow the pinned Python behavior.

## Web Settings

The Web profile registers a Vision Toolkit Settings section for the provider URL, Credential reference, model, OpenAI/Anthropic protocol, Anthropic thinking mode, User-Agent, language, timeout, byte/pixel limits, concurrency, runtime mode, Python override, external source path, and allowed directories. It also shows plugin/upstream versions, the active runtime generation, non-secret Credential configured/source/writable facts, runtime paths, health results, and Artifact-route availability.

The **Plugin updates** card checks the profile's configured npm registry for a newer `@anionex/dsh-vision-toolkit` release. **Update and restart** installs that exact confirmed version into the current DSH profile, verifies the installed package, starts an independent restart helper, and gracefully restarts DSH Web; the open page waits for the replacement process and reloads after the new plugin version is serving. The action is same-origin, fixed to this package, serialized, and unavailable for `link:`, `file:`, workspace, git, URL, transitive, ambiguous, read-only, or missing-`pnpm` installations so local development sources are never overwritten. A restart can interrupt work that is currently running, so the UI requires an explicit confirmation.

`Save and apply` validates the complete value, prepares the candidate Python/upstream runtime, commits the Settings revision, and only then atomically switches generations. A rejected candidate leaves the previous generation serving and is reported separately from a genuinely unavailable runtime. `Reload` always restores the authoritative saved value, even when its revision did not change, so a rejected browser draft is discarded. If initial startup cannot prepare a runtime, the Settings route remains available so a valid configuration can make the first generation operational. A stale browser revision receives a conflict instead of overwriting a newer save; reload before retrying. A read-only Settings provider allows inspection and health checks but disables saves.

`Run health check` performs local checks only. `Test API connection` is an explicit action that sends the configured Credential to `GET /models`; OpenAI uses Bearer authentication, while Anthropic uses `x-api-key` and `anthropic-version`. That lightweight probe uploads no image and creates no completion. `Test vision model` separately sends the bundled `assets/vision-model-test.png` through the same multimodal runtime path as `vision_glance`; it creates one real completion and is the authoritative check that the selected endpoint, credential, model, protocol, and upstream account can process images. The Vision model health card displays a dedicated `Verified`, `Not tested`, or `Test failed` tag, so an HTTP 200 response from `/models` is not presented as a successful image test. Plugin load and ordinary Settings reads never make either request.

Health, connection testing, and plugin/upstream version inspection are administrative Web Settings capabilities rather than model-facing tools, so their schemas never occupy an agent request.

## Artifacts and presentation

Artifact-producing tools write only under `<workspace>/.dsh-vision-toolkit/artifacts`, either as one validated file or an atomically committed run directory. Each model-visible descriptor contains the path, filename, MIME type, kind, description, source tool, preview intent, and byte size, so Headless agents can reuse the path in later calls without browser support. Before a traced SVG is committed, the runtime parses it as XML: standard declarations and comments are accepted, while doctypes, malformed or multi-root documents, a non-SVG namespace, and reported path/byte mismatches are rejected.

When the Web HTTP host is present, presentation-only metadata adds signed capability URLs for preview and download without altering the canonical tool result. Every read revalidates the signature, managed-root fence, path components, regular-file status, size, device/inode identity where available, extension, and MIME. SVG responses use a sandboxed no-resource CSP and the client renders them in a sandboxed iframe. Without an HTTP host, the same cards retain `Open file` through `openFile` and show the descriptor instead of inventing an inaccessible URL.

## Usage patterns

### Basic calls

```text
vision_glance images=["screenshot.png"] query="What error is shown?"
vision_ground image="screenshot.png" target="the send button" preview=true
vision_detect image="screenshot.png" category="buttons" preview=true
vision_crop image="screenshot.png" region="1067,841,1108,881"
vision_trace image="icon.png" color=true output="icon.svg"
vision_pixel_diff original="reference.png" rebuilt="actual.png" runName="comparison"
vision_long_screenshot_ocr image="page.png" mode="general" jobs=2
vision_extract_foreground image="logo.png" mode="color"
vision_dominant_colors image="screen.png" region="0,0,600,300" top=8
vision_html_screenshot source="implementation.html" width=1200 height=720
```

Common workflows are `vision_ground` → `vision_crop` → `vision_glance`, `vision_ground` → `vision_crop` → `vision_trace`, and reference image → `vision_html_screenshot` → `vision_pixel_diff`. Grounding and detection boxes always use original-image pixels (`x1/y1/x2/y2`).

### UI restoration example

The checked-in [UI restoration example](examples/ui-restoration/README.md) renders a reference, an intentionally inaccurate first implementation, and the final implementation through `vision_html_screenshot`, then compares both candidates through `vision_pixel_diff`:

```sh
npm run example:ui-restoration
npm run example:ui-restoration:write
```

The committed evidence records an initial `6.04%` difference across six non-zero worst regions and a final `0%` difference with no non-zero worst region. Check mode reproduces the tool path and verifies the committed assets; write mode intentionally refreshes the evidence.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `Model "..." does not support image input. (attachment-error)` | The image used DSH's native model-attachment channel, so a text-only model rejected the turn before the Skill or Vision Toolkit could run. With image-input variants enabled this is rare: pasting normally auto-switches the session to the `<model> (Vision Toolkit)` variant. If variants are disabled or auto-switch is off, use DSH Paste Input's attachment button, paste, or drop flow so the file is copied into the session workspace and represented by a path, then invoke `/vision-tools`. Restart the Web profile and reload the page after installing or upgrading either browser plugin. |
| Credential reported missing | Paste the key into Web Settings **API key**, keep the advanced **Credential name** aligned with `provider.credential`, save, then rerun health. Headless deployments can provision the same reference in `$DSH_HOME/.credentials.yaml`. Local-only tools do not need it. |
| Runtime preparation fails | Read the Settings runtime error, verify Python 3.11+, package-cache/network access, disk permissions, and the exact external pin. Save only after correcting the candidate; the active generation remains intact. |
| Chrome is not found | Install Chrome, Chromium, or Edge or configure an environment where one is discoverable. Only `vision_html_screenshot` is unavailable. |
| macOS displays a keychain dialog | Confirm the current built adapter is installed and no stale external `html_shot`/headless Chrome process is running. Current launches use a mock keychain and disposable profile; cancel the dialog rather than resetting the login keychain. |
| Input or output path is rejected | Move the file into the session workspace or add an intentional real directory to `allowedDirs`; remove escaping symlinks. Outputs accept a filename, not an absolute or nested path. |
| Vision service returns 401/403 | Replace the Credential value or select the correct reference and endpoint. Errors remain redacted. |
| Vision service returns 429 | Retry after the provider's rate-limit window or lower `concurrency`. The plugin does not silently switch providers. |
| Operation times out or is cancelled | Raise `timeoutMs` within 1000-600000 ms, reduce image/chunk work, or rerun after cancellation. The subprocess/request is stopped with the operation. |
| Settings save reports a conflict | Reload the section to obtain the current revision, reapply the intended edit, and save again. |
| Settings is read-only | Change the active Settings provider or edit the owning profile configuration; the plugin cannot bypass provider writability. |
| Artifact preview is unavailable | Use `Open file` or the model-visible path. Preview/download URLs exist only while a Web HTTP route is attached. |

## Development and verification

```sh
pnpm install --frozen-lockfile --trust-lockfile
pnpm run verify:portable
pnpm run build
pnpm test
pnpm run example:ui-restoration
pnpm pack --dry-run
```

`pnpm run verify:portable` is the dependency-free portable verification gate: it validates the vendored snapshot, package metadata and exports, committed JavaScript syntax, README links and images, required facade files, social-preview dimensions, and the dry-run tarball. The full TypeScript build and test suite run from this standalone checkout against the locked DSH `0.1.0-rc.6` registry packages; the client build also has a separate compiler face that resolves the packages' public exports without internal path aliases. The real Profile acceptance runs when compatible `dsh` and `pnpm` commands are on PATH, and CI requires that path instead of silently skipping it.

`pnpm run build` verifies the vendored manifest before emitting JavaScript, declarations, and the loader-compatible Web client. The package commits `lib/`, so installation from a checkout does not require a consumer-side build. The keyless real-profile test installs into a clean `DSH_HOME`, boots Headless, executes all five P0 tools plus representative P1 local/remote tools through real tool calls, verifies disable and re-enable behavior, and uninstalls the bundle. See the [requirements traceability reference](docs/requirements-traceability/README.md) for the implementation and verification home of every P0/P1 requirement.

Update the upstream snapshot only through `pnpm run upstream:sync -- <checkout>`, inspect the source and license, regenerate the manifest, and update the adapter compatibility tests and committed `lib/` in the same change. The runtime never fetches upstream `main`.

## Project status and scope

Version `0.1.12` is the current public npm release. The product focuses on screenshot understanding, visual grounding, OCR, asset extraction, UI restoration, and pixel-level verification in DSH Web and Headless profiles. Web upload, drag-and-drop, camera/video/audio/document ingestion, interactive box editing, automatic GUI clicking, service clusters, model routing, model voting, and cross-session vision caches remain outside the current product.

<details>
<summary><strong>Maintainer scope note</strong></summary>

The stable `ctx.visionToolkit` service and capability-discovery API remain unpublished until an independent plugin becomes a real consumer. This keeps the public integration surface tied to a tested use case rather than an unvalidated ecosystem contract.

</details>

## Community and About

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing code, protocol, or upstream-snapshot changes.
- Use [GitHub Issues](https://github.com/Anionex/dsh-vision-toolkit/issues) for reproducible bugs, focused feature requests, and usage questions; use [SUPPORT.md](SUPPORT.md) to choose the right channel.
- Report vulnerabilities privately through the process in [SECURITY.md](SECURITY.md), never in a public issue.
- Follow releases and compatibility notes in [CHANGELOG.md](CHANGELOG.md).
- Optional sponsorship is described transparently in [FUNDING.md](FUNDING.md); support does not purchase roadmap priority or private support.
- Use the upstream [project website](https://agent-vision.anionex.me) and [repository](https://github.com/Anionex/agent-vision-toolkit) for the general toolkit, cross-harness integrations, visual-task playbooks, and reference runs.
- Star, share, contribute to, or sponsor `agent-vision-toolkit` if its algorithms or methods save time; DSH-specific bugs and integration requests belong in this repository.

[`agent-vision-toolkit`](https://github.com/Anionex/agent-vision-toolkit) was created by [Anionex](https://anionex.me/). This repository maintains its native DeepSeek Harness integration: DSH owns lifecycle, security, structured schemas, Credentials, Artifacts, and Web presentation, while the upstream project remains the home of the visual algorithms and reusable playbooks.

If you would like to follow my future work, [follow me on X](https://x.com/anion_ex) or [GitHub](https://github.com/Anionex).

## License

The plugin is MIT-licensed. The packaged `agent-vision-toolkit` snapshot retains its upstream MIT license in `vendor/agent-vision-toolkit/LICENSE` and remains the sole implementation of its visual algorithms.
