# Security Policy

## Supported versions

Security fixes target the latest tagged release and the current `main` branch. Older revisions are not supported unless a maintainer explicitly identifies a backport.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Email `davidyang042@gmail.com` with the subject `dsh-vision-toolkit security report`. If GitHub private vulnerability reporting is enabled for the repository, that channel may be used instead.

Include, when relevant:

- the affected release or commit;
- the DeepSeek Harness snapshot/profile, operating system, Node.js version, and Python version;
- the impact and required preconditions;
- minimal reproduction steps or a controlled proof of concept;
- sanitized logs, paths, images, or generated files needed to reproduce the issue;
- a suggested mitigation, if known.

Never send live API keys, authorization headers, private images, complete prompts or conversations, or unrelated workspace files. Replace secrets with placeholders and reduce artifacts to the smallest sample that demonstrates the issue.

The maintainer will acknowledge the report as soon as practical, investigate it privately, and coordinate remediation and disclosure with the reporter.

## Security-relevant areas

Reports are especially useful for issues involving:

- workspace or `allowedDirs` traversal, symbolic-link escape, or unsafe output replacement;
- Credential disclosure through logs, errors, model-visible results, Settings, or child-process environments;
- image upload to an endpoint other than the explicitly configured vision service;
- image bytes, prompts, or unbounded upstream output entering logs or Session events;
- cancellation or timeout failures that leave requests, Python processes, or headless browsers running;
- Artifact preview/download authorization, MIME confusion, or unsafe SVG rendering;
- HTML screenshot access outside authorized local files, unexpected network access, Chrome profile reuse, or macOS keychain access;
- prompt injection in OCR, labels, descriptions, or other content derived from an image;
- client rendering that changes Headless tool semantics or exposes non-model metadata to the model.

## Expected security properties

The plugin is expected to validate decoded image size and format before remote upload, keep API keys in DSH Credentials, pass subprocess arguments without shell interpolation, fence real input/output paths, use disposable headless-browser profiles with a mock keychain, sanitize SVG previews, and expose only structured text and file descriptors to the model. A deviation from these properties is security-relevant even when it does not immediately produce code execution.
