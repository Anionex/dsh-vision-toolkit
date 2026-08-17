# Contributing to DSH Vision Toolkit

Focused fixes, tests, DSH integration improvements, visual workflows, and documentation changes are welcome. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

1. Read [README.md](README.md), the [requirements traceability reference](docs/requirements-traceability/README.md), and the checked-in [UI restoration example](examples/ui-restoration/README.md).
2. Search existing issues and pull requests before opening duplicate work.
3. Open an issue before changing tool schemas, the Skill lifecycle, the Artifact format, the runtime installation model, or the pinned upstream snapshot.
4. Keep each change narrowly scoped. Do not mix a feature or fix with unrelated refactoring or generated-output churn.

## Architecture and scope

DSH Vision Toolkit is an out-of-tree DeepSeek Harness Profile Bundle. Contributions must preserve these responsibilities:

- The pinned `agent-vision-toolkit` snapshot owns visual algorithms. The DSH package owns validation, lifecycle, structured conversion, Credentials, Artifacts, Settings, and Web presentation.
- Ten execution tools remain independent. Runtime readiness does not make every schema globally visible; the `vision-skills` Skill activates them for one Agent.
- Health, connection testing, and version inspection remain administrative Settings actions rather than model tools.
- Model-visible output stays text, numbers, coordinates, JSON, and file descriptors that can be reconstructed from the Session log.
- Credentials, image base64, authorization headers, and unbounded upstream responses never enter model output or logs.
- Inputs and outputs remain fenced to the session workspace or explicit allowed directories, including realpath and symbolic-link checks.
- P2 service stabilization requires a real independent consumer. Do not publish `ctx.visionToolkit` or a provider registry speculatively.

Changes to vendored upstream files must use `npm run upstream:sync -- <checkout>`, preserve the upstream license, update `UPSTREAM_MANIFEST.json`, and include adapter compatibility coverage. Do not edit the snapshot as an untracked fork of the algorithm.

Changes to the model-facing `vision-skills` Skill (the DSH adapter of the
upstream `vision-tools` Skill) must start from the pinned upstream Skill
commit. Update the reviewable adapter patch, then run
`npm run upstream:skill:sync -- <checkout>` and
`npm run upstream:skill:verify`. Preserve upstream methodology and playbooks;
limit adapter changes to native tool invocation, DSH resources/Artifacts,
progressive exposure, and runtime safety boundaries.

## Development setup

The release checkout is installable as-is because `lib/` is committed. Full source development intentionally uses the matching DeepSeek Harness monorepo for peer API types and real profile fixtures:

```text
deepseek-harness/
├── packages/
├── vendor/
├── tsconfig.base.json
└── dsh-vision-toolkit/   # this repository
```

Use the Node.js range declared in `package.json`, Python 3.11 or newer, and the monorepo's `pnpm` installation. Never commit credentials, `.env` values, machine-local dependency paths, managed runtime caches, or generated browser profiles.

## Required verification

Every pull request runs the dependency-free package gate:

```sh
npm run verify:portable
git diff --check
```

From the matching DeepSeek Harness source tree, run the checks that cover the changed surface:

```sh
pnpm run build
pnpm test
pnpm run example:ui-restoration
pnpm pack --dry-run
```

Use focused tests while iterating, but run the complete package suite before requesting review for runtime, lifecycle, schema, Web, Settings, or Artifact changes. A release or upstream update also requires clean temporary Web and Headless installation, `--dump-config`, tool/Skill activation, disable/re-enable, uninstall, and the real UI restoration acceptance path.

## Documentation and visual evidence

- Keep `README.md` and `README.zh.md` synchronized in section order, commands, links, images, and claims.
- Update JSDoc, troubleshooting, and requirements traceability with every user-visible behavior change.
- Use repository-owned screenshots or deterministic outputs. Never fabricate a product state or include secrets, private conversations, or unrelated user data.
- Refresh `assets/hero-v2.png` and `assets/social-preview.png` only when the public positioning or visible product state changes, then inspect the actual pixels.
- Update `CHANGELOG.md` under **Unreleased** for notable user-facing changes.

## Pull requests

A pull request should contain:

- the concrete problem or use case;
- the chosen implementation and why it fits the existing ownership split;
- the exact verification commands and results;
- screenshots, tool transcripts, or fixtures when they prove visual or Web behavior;
- documentation and compatibility updates for every changed user-facing path.

Maintainers may ask to split broad changes, move speculative ecosystem APIs back behind an internal seam, or rework claims that are not backed by source, tests, or a reproducible run.
