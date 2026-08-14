# Changelog

All notable user-facing changes to DSH Vision Toolkit are documented in this file. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

### Fixed

- Accept low-share `vision_dominant_colors` palette and candidate rows whose histogram bar is empty.

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

[Unreleased]: https://github.com/dsh-external/dsh-vision-toolkit/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/dsh-external/dsh-vision-toolkit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/dsh-external/dsh-vision-toolkit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dsh-external/dsh-vision-toolkit/releases/tag/v0.1.0
