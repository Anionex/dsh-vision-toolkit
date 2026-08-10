# Changelog

All notable user-facing changes to DSH Vision Toolkit are documented in this file. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

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

[Unreleased]: https://github.com/dsh-external/dsh-vision-toolkit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dsh-external/dsh-vision-toolkit/releases/tag/v0.1.0
