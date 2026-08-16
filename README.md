<p align="center">
  <img src="assets/hero-v2.png" alt="DSH Vision Toolkit helps text-only DeepSeek Harness agents understand images and complete visual tasks" />
</p>

<div align="center">

# DSH Vision Toolkit

[![Recommended by dshfind](https://img.shields.io/badge/recommended%20by-dshfind-FFD700?style=flat-square)](https://dshfind.com/en/plugins/Anionex/dsh-vision-toolkit)
[![npm](https://img.shields.io/npm/v/@anionex/dsh-vision-toolkit?style=flat-square&color=5B4CF0)](https://www.npmjs.com/package/@anionex/dsh-vision-toolkit)
[![MIT](https://img.shields.io/badge/license-MIT-0B7285?style=flat-square)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-Web%20%2B%20Headless-5B4CF0?style=flat-square)](cordis.patch.yml)

**Give text-only DSH agents eyes: paste an image, ask a question, locate exact elements, extract assets, and verify UI restoration with measurable results.**

🌐 **English** | [中文](README.zh.md)

</div>

When you run DeepSeek or another text-only model in DeepSeek Harness (DSH), familiar problems appear quickly: the model cannot see a screenshot, generic image descriptions miss the point, buttons have no usable coordinates, and a rebuilt page may look “close enough” without any way to measure the remaining difference.

DSH Vision Toolkit packages [`agent-vision-toolkit`](https://github.com/Anionex/agent-vision-toolkit) as a native DSH plugin. It helps an agent do more than describe an image: the agent can read, locate, crop, trace, rebuild, and verify visual work around the task at hand.

> **Install and use it immediately.** The default setup includes a free Gemma 4 vision service and requires no API key. Cropping, pixel diffing, color analysis, foreground extraction, SVG tracing, and HTML screenshots run locally without spending vision API requests.

```sh
dsh plugin --profile web add @anionex/dsh-vision-toolkit
```

**Upstream toolkit:** [Anionex/agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) · **Project website:** [agent-vision.anionex.me](https://agent-vision.anionex.me)

<details>
<summary><strong>Table of contents</strong></summary>

- [Recent updates](#recent-updates)
- [Problems it solves](#problems-it-solves)
- [See it in action](#see-it-in-action)
- [Highlights](#highlights)
- [Quick start: three steps](#quick-start-three-steps)
- [Common workflows](#common-workflows)
- [Toolbox](#toolbox)
- [Configuration and limits](#configuration-and-limits)
- [Troubleshooting](#troubleshooting)
- [Development and community](#development-and-community)

</details>

## Recent updates

- **2026-08-16 · Windows Python:** Added Microsoft Store Python support, fixing first-time isolated-runtime setup failures for affected Windows users.
- **2026-08-16 · Better free vision:** Switched the default model to Gemma 4, improving the no-key image-understanding path.
- **2026-08-16 · Image paste:** Text-only routes now switch to a `(Vision Toolkit)` variant and keep a workspace path, fixing blocked pastes and images that could not be reused later.
- **2026-08-16 · Higher free quotas:** Raised per-client, global, and burst limits to `100/day`, `400/day`, and `20/minute`, reducing avoidable rate-limit failures while the shared capacity is lightly used.
- **2026-08-16 · Real model test:** Added a full image-request test in Settings, fixing the false confidence caused by a successful `/models` request to a model that still cannot process images.

## Problems it solves

| The problem | What Vision Toolkit delivers |
|---|---|
| **A text-only model cannot see a screenshot** | Paste an image in DSH Web; the plugin obtains visual evidence and returns the task-relevant parts to the text model |
| **The description is long but misses the point** | Ask “Where is the error?” or “What color is the submit button?” and receive an answer focused on that question |
| **The model knows an element exists but cannot act on it** | Get original-image pixel coordinates and an optional labeled or numbered preview |
| **Long-screenshot OCR skips or duplicates lines** | Split and audit the image while preserving Markdown, chunks, manifests, and resumable run state |
| **UI restoration is judged by feel** | Compare the reference and implementation screenshots to get a difference percentage, ranked regions, a heatmap, and JSON |
| **Screenshot assets cannot be reused** | Produce a crop, transparent PNG, color palette, or editable SVG instead of stopping at prose |

## See it in action

### Paste an image directly into DSH

<p align="center">
  <img src="assets/dsh-view-example.png" width="82%" alt="A text-only DeepSeek model answering a question about a pasted image through Vision Toolkit in DSH Web" />
</p>

*Paste an image into the conversation. A text-only model can switch to its `Vision Toolkit` variant and inspect the image in the context of the user's question.*

### Screenshot to editable page

<p align="center">
  <img src="assets/upstream/infographic-reference.webp" width="49%" alt="Reference infographic screenshot used for restoration" />
  <img src="assets/upstream/infographic-result.webp" width="49%" alt="Editable HTML and CSS reconstruction created from the reference screenshot" />
</p>

*Left: the reference screenshot. Right: an editable HTML/CSS result. The result can continue into screenshot rendering and pixel comparison instead of ending as an image description.*

### Sketch to working interface

<p align="center">
  <img src="assets/upstream/ui-sketch.webp" width="49%" alt="Hand-drawn JupyterLab interface used as the restoration reference" />
  <img src="assets/upstream/ui-result.webp" width="49%" alt="Working JupyterLab-style interface reconstructed from the sketch" />
</p>

*Left: a hand-drawn reference. Right: the working interface reconstructed from it.*

### Turn “looks close” into a verifiable result

The repository includes a reproducible UI-restoration example. The first implementation differs from the reference by **6.04%**. After the highlighted regions are corrected, the final `1200 × 720` render reaches **0% pixel difference**.

<p>
  <img src="examples/ui-restoration/assets/initial.png" width="49%" alt="Initial UI implementation with measurable layout and styling differences" />
  <img src="examples/ui-restoration/assets/implementation.png" width="49%" alt="Final UI implementation after visual diagnosis, reaching zero pixel difference" />
</p>

## Highlights

- **Free by default.** New installations use the built-in Gemma 4 service without requiring another account or API key.
- **Focused on the current task.** The agent sends the reason it needs to inspect the image, so the result emphasizes useful evidence instead of producing a generic caption.
- **Outputs you can keep working with.** Coordinates, OCR, transparent PNGs, SVGs, screenshots, heatmaps, and JSON can feed directly into the next step.
- **Built for UI and screenshot work.** Reference analysis, element location, asset extraction, HTML rendering, and pixel comparison form one continuous workflow.
- **Local where possible.** Crop, trace, pixel diff, color, foreground, and HTML screenshot operations do not need a remote vision model.
- **The same capabilities in Web and Headless.** Web users can preview and download artifacts; Headless runs still receive replayable structured results and workspace paths.

## Quick start: three steps

### 1. Install

```sh
dsh plugin --profile web add @anionex/dsh-vision-toolkit
```

You can install it into a Headless Profile too:

```sh
dsh plugin --profile headless add @anionex/dsh-vision-toolkit
```

### 2. Restart and check it

Restart a running Web Profile, then open **Settings → Vision Toolkit**. The free provider is already configured; run **Test vision model** to confirm it is reachable.

The first start prepares an isolated runtime, so it needs access to the Python package cache or the network. A normal installation does not require an `agent-vision-toolkit` source checkout or a local path setting.

### 3. Paste an image and describe the outcome you want

Paste a screenshot into the conversation or place an image in the session workspace, then invoke `/vision-tools`. For example:

```text
Inspect this screenshot. Explain the error and tell me what to fix first.
Find the login button in the top-right corner, return original pixel coordinates, and make a boxed preview.
Crop this icon and convert it to SVG.
Rebuild the page from reference.png. After each pass, render it and run a pixel diff until the major differences are gone.
```

## Common workflows

| Task | Recommended workflow |
|---|---|
| Image Q&A or screenshot debugging | Inspect → answer around the current question → locate details when needed |
| Find a button, icon, or text region | Ground the target → return pixel box → create a labeled preview |
| Extract an icon from a screenshot | Ground → crop → trace to SVG |
| Read a long webpage screenshot | Split → OCR → merge Markdown → audit boundaries |
| Recreate a page or component | Reference → implementation → HTML screenshot → pixel diff → iterate |
| Extract brand visuals | Crop region → analyze dominant colors → extract foreground → export transparent PNG |

## Toolbox

The plugin provides 10 tools that can be called independently or composed into a workflow:

| Tool | Best question to ask | Main result |
|---|---|---|
| `vision_glance` | “What is happening in this image?” | Focused answer, description, OCR, or multi-image comparison |
| `vision_ground` | “Where is the thing I need?” | Original pixel coordinates and optional boxed preview |
| `vision_detect` | “Which buttons, icons, or elements are present?” | Numbered element inventory, coordinates, and optional preview |
| `vision_crop` | “Extract this region as its own image” | PNG or JPEG crop |
| `vision_trace` | “Turn this shape into an editable vector” | SVG |
| `vision_pixel_diff` | “Where does the implementation differ from the reference?” | Difference percentage, ranked regions, heatmap, and JSON |
| `vision_long_screenshot_ocr` | “Read this entire long screenshot” | Markdown, chunks, manifest, and audit output |
| `vision_extract_foreground` | “Remove the background from this subject” | Transparent PNG |
| `vision_dominant_colors` | “Which colors dominate this area?” | Palette or ranked candidate colors |
| `vision_html_screenshot` | “Render this local page at an exact viewport or capture the full page” | PNG and optional CSS `pageHeight` |

Coordinates always use original-image pixels in `x1,y1,x2,y2` form, so grounding output can feed directly into cropping, tracing, or later automation.

For a long HTML document, pass `fullPage=true`. The requested width and height remain the layout viewport, while the resulting PNG covers the complete document and reports `pageHeight` in CSS pixels.

## How it works

The plugin keeps image understanding and deterministic local image processing in one Agent workflow. Expand the flow below for the implementation boundary.

<details>
<summary><strong>Architecture and image-input behavior</strong></summary>

```mermaid
flowchart LR
    Image["Screenshot or local HTML"] --> Skill["vision-tools Skill"]
    Skill --> Agent["Text agent selects a task"]
    Agent --> Vision["Use a vision model when image understanding is needed"]
    Agent --> Local["Run crop, SVG, and pixel work locally"]
    Vision --> Result["Answer, OCR, coordinates"]
    Local --> Artifact["PNG, SVG, heatmap, JSON"]
    Result --> Session["Continue reasoning and acting"]
    Artifact --> Session
```

The visual capabilities come from a packaged, pinned `agent-vision-toolkit` snapshot. The DSH plugin handles installation, session-scoped tool exposure, Credentials, path checks, cancellation, timeouts, result files, and Web presentation. The runtime never fetches upstream `main` in the background.

For routes that DSH positively identifies as text-only, the plugin registers a sibling `<model> (Vision Toolkit)` variant. By default, pasting an image in DSH Web switches to that variant and gives the model both a reusable workspace path and a visual description focused on the current task.

</details>

## Configuration and limits

### Built-in free service

The default setup uses:

```text
Base URL: https://vision.anionex.me/v1
Model:    gemma-4-26b-a4b-it
API Key:  no user configuration required
```

This is a shared zero-configuration entry point, not an unlimited private endpoint. Current limits are:

| Limit | Current value |
|---|---:|
| Per client | 100 requests per UTC day |
| Whole service | 400 requests per UTC day |
| Burst | 20 requests per 60 seconds |
| Image size | 4 MiB per image |
| Decoded pixels | 20,000,000 per image |
| Output | 512 tokens per request |

The limits protect shared capacity and prevent unusually large images from monopolizing memory or request time. When a limit is reached, the service returns a readable reason and error code. Rate-limit responses also include `Retry-After` instead of collapsing into an unexplained model failure.

### Bring your own vision model

For higher quotas, private endpoints, or another model, change the provider in **Settings → Vision Toolkit** and store the API key as a DSH Credential. Settings stores the Credential reference and never reads the saved secret back into the browser.

You can also configure a Profile patch:

```yaml
- id: vision-toolkit
  config:
    provider:
      baseUrl: https://api.example.com/v1
      credential: MY_VISION_KEY
      model: your-vision-model
      protocol: openai
```

OpenAI Chat Completions-compatible endpoints and Anthropic Messages are supported. The Web Settings panel exposes the full provider, runtime, timeout, image-limit, and image-input-variant configuration.

### Requirements

- A DeepSeek Harness Web or Headless Profile.
- Node.js `^22.19.0` or `>=24.0.0`.
- Python 3.11+; the plugin prepares an isolated environment by default.
- Only `vision_html_screenshot` requires Chrome, Chromium, or Edge.
- Inputs must be PNG, JPEG, GIF, or WebP files in the session workspace or an explicitly allowed directory.

<details>
<summary><strong>Install, upgrade, disable, and uninstall</strong></summary>

```sh
dsh plugin --profile web update @anionex/dsh-vision-toolkit
dsh plugin --profile web remove @anionex/dsh-vision-toolkit
```

If you are migrating from the retired `@dsh-external/dsh-vision-toolkit`, remove the old package first and install `@anionex/dsh-vision-toolkit`.

To disable the bundle temporarily, set this in the Profile patch:

```yaml
- id: vision-toolkit
  disabled: true
```

Restart the Web Profile and refresh the page after enabling or upgrading the Web plugin.

</details>

## Troubleshooting

| Problem | What to do |
|---|---|
| Pasting an image still says the model does not support image input | Restart the Web Profile, refresh the page, and confirm the selected route has the `(Vision Toolkit)` suffix. You can also place the image in the session workspace and invoke `/vision-tools` |
| The free service returns 429 | Wait for the `Retry-After` interval, or switch to your own endpoint when you need stable higher volume |
| The image exceeds a size or pixel limit | Crop or resize it first; the error identifies whether bytes or decoded pixels caused the rejection |
| A custom Credential is missing | Enter the API key in **Settings → Vision Toolkit** and confirm the Credential name matches the provider configuration |
| First-time runtime setup fails | Check Python 3.11+, network or package-cache access, and disk permissions, then retry the model test in Settings |
| Chrome is not found | Install Chrome, Chromium, or Edge. Only HTML screenshot rendering is unavailable; the other tools still work |
| An artifact cannot be previewed | Use **Open file** or the workspace path in the result. Preview URLs exist only while the Web route is available |

## Project status and limitations

The current release focuses on screenshot understanding, visual grounding, OCR, asset extraction, UI restoration, and pixel-level verification. It is not a video, audio, or camera-input system and does not automatically click GUI controls. Interactive box editing, remote service clusters, model voting, and cross-session visual caches are also outside the current scope.

## Development and community

```sh
pnpm install --frozen-lockfile --trust-lockfile
pnpm run verify:portable
pnpm run build
pnpm test
TSX_TSCONFIG_PATH=tsconfig.json pnpm dlx tsx scripts/ui-restoration-example.ts --check
```

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.
- Use [GitHub Issues](https://github.com/Anionex/dsh-vision-toolkit/issues) for bugs, focused feature requests, and usage questions; see [SUPPORT.md](SUPPORT.md) for channel guidance.
- Report vulnerabilities privately through [SECURITY.md](SECURITY.md).
- See [CHANGELOG.md](CHANGELOG.md) for releases and [FUNDING.md](FUNDING.md) for sponsorship details.
- Visit upstream [agent-vision-toolkit](https://github.com/Anionex/agent-vision-toolkit) for the general toolkit, cross-agent integrations, and visual-task playbooks.

<p align="center">
  <img src="assets/community-group-qr.png" alt="QR code for the agent-vision-toolkit community group" width="240" />
</p>

[`agent-vision-toolkit`](https://github.com/Anionex/agent-vision-toolkit) was created by [Anionex](https://anionex.me/). This repository maintains its native DeepSeek Harness integration.

## License

The plugin is available under the [MIT License](LICENSE). The packaged upstream snapshot retains its original MIT license in [`vendor/agent-vision-toolkit/LICENSE`](vendor/agent-vision-toolkit/LICENSE).
