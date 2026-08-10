## Problem

<!-- What concrete user, integration, or maintenance problem does this change solve? -->

## Change

<!-- Summarize the implementation and the affected tools, lifecycle paths, files, or public claims. -->

## Verification

<!-- List the exact commands and results. Include focused tests plus the strongest practical assembled-profile or visual evidence. -->

- [ ] `npm run verify:portable`
- [ ] Focused tests for the changed behavior
- [ ] `pnpm run build` and `pnpm test` when source/runtime/client behavior changed
- [ ] Clean Web/Headless, Artifact, Settings, or UI-restoration evidence when the affected surface requires it
- [ ] `git diff --check`

## Product and security checklist

- [ ] I preserved independent tool schemas and Agent-scoped progressive exposure.
- [ ] I kept health/version administration out of model tool schemas.
- [ ] I did not expose credentials, image base64, authorization headers, private data, or unbounded upstream output.
- [ ] I updated README/JSDoc/troubleshooting/traceability and `CHANGELOG.md` for user-visible changes.
- [ ] I kept `README.md` and `README.zh.md` synchronized.
- [ ] I used repository-owned, sanitized visual evidence for visible changes.
- [ ] Upstream algorithm changes, if any, came through the documented sync and manifest process.

## Screenshots or artifacts

<!-- Add only evidence that materially verifies visual or Web behavior. Remove this section when it is not applicable. -->
