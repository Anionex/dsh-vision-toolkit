# Changelog

All notable user-facing changes to DSH Vision Toolkit are documented in this file. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Anionex/dsh-vision-toolkit/releases/tag/v0.1.0
