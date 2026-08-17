# Changelog

All notable user-facing changes to DSH Vision Toolkit are documented in this file. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

### Changed

- Renamed the bundled Skill from `vision-tools` to `vision-skills`, so the model-facing name describes the capability instead of the underlying tools. Sessions created before the rename still restore activation from legacy `vision-tools` history; new sessions invoke `/vision-skills`.

## [0.1.30] - 2026-08-17

### Changed

- Raised the default vision operation timeout from 15 seconds to 30 seconds for both semaphore queueing and tool execution.
- Removed the practical global ceiling on the built-in free vision service (raised from 5,000 to 1,000,000,000 requests per UTC day) while keeping the per-client daily and burst quotas.

## [0.1.29] - 2026-08-17

### Added

- **Install and use with zero Python setup.** When no system Python 3.11+ is available, the plugin downloads a pinned, sha256-verified standalone Python 3.13 build (about 35 MB) on first use and prepares its isolated runtime with it, so new users no longer need to install Python first. A system Python or an explicit `runtime.python` override still takes precedence, and a committed manifest plus `scripts/python-bootstrap.mjs` keeps the pinned build auditable and updatable.

### Fixed

- Keep the `vision_toolkit_activate` bootstrap callable until the end of the model step when the Skill and the bootstrap are invoked in parallel, preventing a race that surfaced as `unknown tool "vision_toolkit_activate"` while the Skill call was already activating the visual tools.
- Reword the `vision-tools` Skill description so screenshot-to-UI restoration reliably triggers visual-tool activation.

## [0.1.28] - 2026-08-17

### Fixed

- Treat HTTP 403 from `GET /models` as a warning instead of claiming the API key was rejected, because providers such as Groq can restrict the model-list endpoint while real multimodal requests still work. Settings now notes that this warning can be ignored when the real vision-model test reports success.

## [0.1.27] - 2026-08-17

### Added

- Automatically compress input images above `maxImageBytes` (4 MiB default) or `maxImagePixels`, preferring lossless PNG/WebP/GIF re-encodes before lossy quality reduction and, as a last resort, downscaling.
- Accept pasted images up to 20 MiB and compress them on first tool use instead of rejecting anything above `maxImageBytes`.
- Persist compressed copies in a versioned, hash-verified workspace cache so repeated calls reuse the same compressed image.
- Keep original display names on crop/trace/long-OCR/foreground/pixel-diff outputs and preserve EXIF/ICC metadata when re-encoding.

### Fixed

- Reject tampered or symlinked compressed-cache entries and prune stale or oversized cache files.
- Mark JPEG q95 as lossy and try true lossless PNG/WebP re-encodes first for every source format.

## [0.1.26] - 2026-08-17

### Docs

- Documented how and when to configure the Python 3.11+ `runtime.python` override with system interpreters, project-local virtual environments, and the Windows `py` launcher.
- Added reproducible `uv` setup, managed-versus-external dependency guidance, Profile health/model checks, and a `vision_glance` smoke-test workflow.
- Clarified automatic platform temporary-directory authorization, Windows `/tmp/...` mapping, extra `allowedDirs` roots, and ignored project-local `.venv/` directories.

## [0.1.25] - 2026-08-17

### Fixed

- Added the documented `VISION_SSL_VERIFY` escape hatch for trusted self-signed or MITM-proxied vision endpoints, forwarded it through the isolated DSH runtime, and kept TLS certificate verification enabled by default.
- Allowed `vision_toolkit_activate` to mount the visual tool schemas even when the model invokes the bootstrap before loading the `vision-tools` Skill, removing the activation deadlock while preserving Agent-scoped exposure.
- Authorized the platform temporary directory for visual inputs and mapped model-generated `/tmp/...` paths to `%TEMP%` or `%TMP%` on Windows, while retaining realpath fencing and model-visible path guidance.

## [0.1.24] - 2026-08-17

### Fixed

- Kept Vision Toolkit Settings panels, form fields, action buttons, and advanced runtime details within the available Web Settings modal width instead of forcing horizontal overflow and clipping the right column.

## [0.1.23] - 2026-08-17

### Added

- Settings now links to the Groq Qwen3.6-27B tutorial and shows a one-line manual update command with a copy button.

## [0.1.22] - 2026-08-17

### Docs

- Added a step-by-step Groq tutorial (English and 中文) for obtaining a free API key and using Qwen3.6-27B for image understanding, with screenshots and ready-to-run cURL/Python examples.

## [0.1.21] - 2026-08-17

### Changed

- Switched the built-in free vision service to Gemini 3.7 Flash by default; Qwen-compatible requests keep routing through Groq.
- Split grounding prompts by model family so Gemini and Qwen each use their native bounding-box coordinate order.

### Fixed

- Fixed Qwen detection boxes being swapped by prompting Qwen with `x0,y0,x1,y1` and Gemini with `y0,x0,y1,x1`.
- Return the standard non-retryable `rate_limit_exceeded` code when every upstream is cooling down, preventing the 15-second client deadline from hiding an immediate provider-capacity response as a timeout.

## [0.1.20] - 2026-08-17

### Changed

- Allocate Groq accounts through persistent active-request and cooldown state, preferring the least-active available account instead of hashing concurrent requests onto colliding keys.
- Give semaphore queueing and tool execution separate timeout budgets, so waiting for a session slot no longer consumes the 15-second vision inference deadline.

### Fixed

- Cool down rate-limited, unauthorized, and transiently failing Groq accounts before retrying another account, reducing repeated collisions and timeout cascades during concurrent visual grounding.
- Report queue time separately in runtime diagnostics and return an explicit queue-timeout message when the session concurrency gate itself is saturated.

## [0.1.19] - 2026-08-17

### Changed

- Raised the built-in public vision service output ceiling from 512 to 4,096 tokens, leaving enough room under Groq's free-tier token budget for image input while avoiding premature truncation of dense element inventories.

### Fixed

- Parse Qwen-family grounding coordinates as `x0,y0,x1,y1` while retaining Gemini-family `y0,x0,y1,x1` compatibility and an explicit override for custom providers.
- Reject incomplete bounding-box JSON instead of silently returning a misleading partial detection result, and avoid duplicating already-complete detect category instructions.

## [0.1.18] - 2026-08-16

### Changed

- Rebased the model-facing `vision-tools` Skill on the upstream `SKILL.md` and
  all five upstream playbooks, changing only native DSH tool invocation,
  Artifact/resource delivery, progressive exposure, and DSH runtime boundaries.
- Added an exact upstream Skill commit/hash manifest, a reviewable adapter
  patch, and repeatable sync/verification commands so future upstream updates
  fail closed when the adaptation no longer applies cleanly.
- Expanded the built-in free vision service capacity and provider pool to
  reduce peak-time exhaustion without changing the existing client safeguard.
- Replaced the built-in public compatibility key with the project URL while
  continuing to accept the legacy `api_key="free"` value for existing installs.
- Reduced the default vision operation timeout from 60 seconds to 15 seconds.

### Fixed

- Removed the stale single-image restriction from the public Groq vision proxy; one request can now forward up to five images in their original order.
- Returned sanitized Groq validation details and descriptive request-size errors instead of retrying non-retryable failures across every provider account.
- Returned explicit quota `429` responses immediately, including retry guidance, instead of retrying them until the client reported a timeout.

### Removed

- Removed the GitHub Pages workflow: the public project website is
  `agent-vision.anionex.me` and the repository has no Pages site enabled, so the
  job always failed at the Pages configuration step.

## [0.1.17] - 2026-08-16

### Changed

- Clarified in both READMEs that the visual-tool system, its division of responsibilities, and the `vision-tools` Skill are original work, and refreshed the bilingual pairing record.

## [0.1.16] - 2026-08-16

### Changed

- Allowed registry-installed Profiles to install plugin updates even when the running DSH Web process cannot safely restart itself; the Settings page now asks the user to restart DSH Web manually when needed.
- Clarified update status and confirmation text so installation and process restart are reported as separate steps.

## [0.1.15] - 2026-08-16

### Fixed

- Fixed the Settings runtime health check reporting a false artifact-directory failure when DSH Desktop starts from a read-only installation directory. The check now uses the prepared runtime home and validates output readiness independently from session-relative input directories.

## [0.1.14] - 2026-08-16

### Changed

- Switched the built-in free vision service from Cloudflare Workers AI Gemma 4 to Groq Qwen3.6 (`qwen/qwen3.6-27b`), with three server-side API keys rotated across requests and no change to the public OpenAI-compatible endpoint.
- Raised the shared Worker ceiling to 3,000 requests per UTC day and 60 requests per minute to match the combined request capacity of the three Groq free-tier accounts more closely, while keeping the per-client ceiling at 100 requests per day.

## [0.1.13] - 2026-08-16

### Added

- Added `fullPage=true` to `vision_html_screenshot`; the Chrome DevTools Protocol path preserves the requested layout viewport, captures the complete document, and reports `pageHeight` in CSS pixels while leaving fixed-viewport captures unchanged.
- Added a **Plugin updates** Settings card that checks the configured npm registry, installs an explicitly confirmed release into the current registry-backed DSH profile, verifies it, and can restart an explicitly opted-in fixed-port POSIX DSH Web process through an independent readiness/rollback helper. Token-owned cross-process locking, pre-update manifest/lockfile backups, bounded rollback commands, and exact-version recovery protect the Profile across failed installs and restart handoff. Local/workspace/git/URL and otherwise unsafe-to-replace installs remain read-only; Windows, dynamic-port, and manager-owned processes keep restart ownership outside the plugin.

### Fixed

- Fixed managed runtime creation failing with exit status 101 when the Microsoft Store Python is used on Windows: the venv is now created with `--without-pip`, the staged `pyvenv.cfg` `home`/`executable` are rewritten to the app execution alias directory, and pip is bootstrapped explicitly.

## [0.1.12] - 2026-08-16

### Fixed

- Kept persisted v0.1.10 Moondream free-provider settings on the built-in `api_key="free"` path after upgrading, so existing installations do not require a DSH Credential.
- Aligned direct `point` and `detect` task coordinates with the toolkit's 0-1000 grid and rejected malformed structured locations instead of returning false-success responses.

## [0.1.11] - 2026-08-16

### Changed

- Raised the built-in free vision service limits from 30 to 100 requests per client per UTC day, from 120 to 400 requests globally per UTC day, and from 6 to 20 requests per 60 seconds.
- Switched the built-in free vision backend from Moondream 3.1 to Cloudflare Workers AI Gemma 4 (`@cf/google/gemma-4-26b-a4b-it`) while keeping the public OpenAI-compatible endpoint unchanged.

## [0.1.10] - 2026-08-16

### Added

- Added a built-in free Moondream vision provider at `https://vision.anionex.me/v1`, using the OpenAI Chat Completions protocol with `api_key="free"`. Fresh installations can use remote vision tools without configuring a DSH Credential.
- Added an OpenAI-compatible Cloudflare Worker proxy for the bundled service, including bounded image validation, daily and burst quotas, and explicit rate-limit responses.

### Changed

- Changed the default provider to `moondream-3.1` with a 4 MiB per-image limit and a 20,000,000-pixel per-image limit.
- Kept custom OpenAI-compatible and Anthropic providers supported; changing the endpoint, model, or protocol unlocks the API key field and restores normal DSH Credential handling.

### Fixed

- Prevented browser-side or same-origin credential writes from storing a user key under the read-only built-in free provider reference.
- Aligned automatic image-input descriptions with the pinned upstream focus-hint contract: the bridge now derives intent from the current user request or latest assistant paragraph, ignores injected context prefixes, and keys cached evidence by that focus prompt.
- Made shared attachment reads bounded and cancellation-safe so queued descriptions can stop without aborting another consumer that is still using the same image read.

## [0.1.9] - 2026-08-16

### Added

- Added an explicit **Test vision model** Settings action that sends a bundled diagnostic image through the same multimodal runtime path as `vision_glance`, so a successful `/models` response can no longer be mistaken for proof that the configured model and upstream account can process images.

### Changed

- Renamed the lightweight Settings probe to **Test API connection**, made its copy explicit that it only calls `GET /models`, and added a dedicated verified/not-tested/failed Tag to the real vision-model result.

## [0.1.8] - 2026-08-16

### Added

- Pasting an image with a plain text-only model now works like a multimodal model with zero manual steps: the browser integration asks the host with the exact model route, the host answers an auto-switch instruction when the image-input variant exists, and the client switches the session by itself and replays the paste into the composer's native intake (thumbnail, limits, keyboard). A failed switch or an environment that cannot replay clipboard bytes degrades to the paste-to-path takeover with the same files; `imageInputVariants.autoSwitch` (default `true`) turns the auto-switch off.
- Text-only model routes now get `(Vision Toolkit)` image-input variants in the model selector. Selecting a variant keeps the native paste and attachment flow — composer thumbnail and durable session image — and the plugin rewrites image blocks into Vision Toolkit descriptions only on the wire to the model. Variants are registered automatically for every model the host declares text-only and can be disabled or restricted via `imageInputVariants`.
- The browser paste interception now asks the host before taking a paste over: pastes stay native for image-capable models (including the variants) and are converted to workspace paths only for models the host confirms text-only.

## [0.1.7] - 2026-08-15

### Added

- Added a write-only API key field to Web Settings so users can configure online vision without opening the credential file; saved values are never returned to the browser.

### Changed

- Moved the credential reference name into Advanced settings and protected browser credential writes with same-origin, Settings revision, and active-reference checks.

## [0.1.6] - 2026-08-14

### Added

- Added native Anthropic Messages transport with configurable thinking behavior, provider-compatible User-Agent overrides, and matching Web Settings controls.

### Changed

- Restored the user-first Web Settings hierarchy: required provider fields appear first, advanced compatibility and runtime controls are collapsed, and plugin identity, versions, and runtime generation are shown in the footer.
- Replaced internal-facing Settings, health, tool-card, and artifact labels with concise English and Simplified Chinese user copy.

### Fixed

- Keep the DSH Credential, endpoint, protocol, thinking mode, and User-Agent authoritative when the pinned upstream runs beside ignored `.env` files.
- Use Anthropic authentication headers for explicit `/models` connection tests and retry overloaded Anthropic responses with bounded `Retry-After` handling.

## [0.1.5] - 2026-08-14

### Added

- Pasted clipboard images are copied into the active workspace and represented as stable input references, with per-image progress, retry-safe serialization, and removal controls.

### Changed

- Development builds and tests resolve the published DSH `0.1.0-rc.6` package set directly instead of depending on a neighboring Harness checkout.

### Fixed

- Accept low-share `vision_dominant_colors` palette and candidate rows whose histogram bar is empty.
- Use Harness design tokens for every Vision Toolkit surface color, including preview checkerboards, download actions, status indicators, alerts, fields, and pasted-image chips, so light and dark themes remain readable without light-only fallback colors.
- Require the compatible DSH `0.1.0-rc.6` release line so package managers cannot select the broken `dsh-client-runtime@0.0.1-rc.1` release through the `latest` dist-tag.
- Use the published `@deepseek-ai/dsh-client-ui-input-trigger` package while retaining runtime registration compatibility with the earlier `ctx.slash` service alias.
- Publish only rescoped `@deepseek-ai/cordis` imports and declare every directly consumed DSH host/client peer.
- Pin NumPy to the newest release that still supports the documented Python 3.11 minimum, so managed runtime preparation works on Python 3.11.

## [0.1.4] - 2026-08-14

### Changed

- Package metadata (`repository`, `bugs`) points at the public `Anionex/dsh-vision-toolkit` repository; the portable verification gate tracks the current version.

## [0.1.3] - 2026-08-14

### Added

- Web pasted-image degradation (`degradePastedImages`, default off): when the session model cannot accept images, pasted images are saved into the session workspace (`.dsh-vision-toolkit/pastes/`) and handed to the model as file paths, so the agent reads them through the visual tools with a visible tool workflow. Native vision models are preferred and never take this path.

### Fixed

- Upstream `vision_client.py` sends a stable `User-Agent`, avoiding HTTP 403 responses from gateways that reject the urllib default agent; the vendored manifest hash records the patched file.
- Peer dependency ranges were widened for the published prerelease packages. Version 0.1.5 supersedes those ranges because SemVer does not admit the `0.1.0-rc.*` line through a comparator starting at `0.0.1-rc.1`.

## [0.1.2] - 2026-08-11

### Changed

- Repositioned the README, landing page, hero, social preview, package metadata, and About copy around the product's exact role as the native DeepSeek Harness integration for `agent-vision-toolkit`.
- Added direct, prominent links to the upstream repository and first-party project website.
- Added optimized official upstream reference images for infographic restoration, sketch-to-UI restoration, image Q&A, and screenshot-guided debugging, with exact commit provenance and explicit separation from DSH-native proof.
- Set the package homepage to the first-party `agent-vision-toolkit` website and expanded discovery keywords for text-only agents, Agent Skills, and vision-language models.

## [0.1.1] - 2026-08-11

### Changed

- Replaced private-repository GitHub metadata badges with versioned static badges that remain truthful without unauthenticated repository access.
- Gated GitHub-hosted CI and Pages jobs to public repository visibility while keeping the workflows ready for a future visibility change.

### Fixed

- Package homepage and bilingual release guidance now point authenticated users to the private repository instead of an unavailable public Pages site.

## [0.1.0] - 2026-08-10

### Added

- Portable DeepSeek Harness Profile Bundle support for Web and Headless profiles, with committed runtime and client build artifacts.
- Five P0 tools: `vision_glance`, `vision_ground`, `vision_detect`, `vision_trace`, and `vision_crop`.
- Five P1 tools: `vision_pixel_diff`, `vision_long_screenshot_ocr`, `vision_extract_foreground`, `vision_dominant_colors`, and `vision_html_screenshot`.
- Agent-scoped progressive tool exposure through the bundled `vision-tools` Skill and one temporary activation bootstrap.
- Managed and exact external Python runtime modes backed by a pinned, manifest-verified `agent-vision-toolkit` snapshot.
- DSH Credentials integration, hard operation deadlines, cancellation propagation, per-session concurrency, bounded single-task glance reuse, metrics, and stable redacted errors.
- Workspace-fenced Artifact creation for images, SVG, Markdown, and JSON, including signed Web preview/download routes and local open-file fallback.
- Dedicated Web tool cards plus live Settings for configuration, health, connection testing, runtime preparation, and version inspection.
- Reproducible UI restoration acceptance workflow with committed `6.04%` initial and `0%` final pixel-difference evidence.
- Bilingual product, troubleshooting, requirements traceability, and UI restoration documentation.
- Dependency-free portable package CI, structured issue forms, contribution and security policies, support guidance, funding disclosure, project hero, and social-preview asset.

### Fixed

- Headless Chrome rendering now uses a disposable profile, `--use-mock-keychain`, and cleanup that avoids the user's daily Chrome profile and macOS login keychain.
- Failed or obsolete Settings candidates cannot replace the active runtime generation or stored usable configuration.
- SVG output validation fails closed on malformed, unsafe, or semantically invalid vtracer output.
- Runtime teardown cancels in-flight operations before removing Agent-scoped tools, the activation bootstrap, and the Skill.
- The Web client is published through the current nested `dsh.client` manifest and loader-compatible built artifact required by DSH snapshot0810.

[Unreleased]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.30...HEAD
[0.1.30]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.29...v0.1.30
[0.1.29]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.28...v0.1.29
[0.1.28]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.27...v0.1.28
[0.1.27]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.26...v0.1.27
[0.1.26]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.25...v0.1.26
[0.1.25]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.24...v0.1.25
[0.1.24]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.23...v0.1.24
[0.1.23]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.22...v0.1.23
[0.1.22]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Anionex/dsh-vision-toolkit/releases/tag/v0.1.0
