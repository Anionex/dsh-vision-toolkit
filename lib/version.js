/**
 * Plugin and pinned upstream version facts. The upstream snapshot is fixed at
 * build time and recorded in package.json's `dsh.visionToolkit` metadata so
 * the runtime, tool results, and docs all report the same source commit.
 * @module dsh-vision-toolkit/version
 */
import { readFileSync } from 'node:fs';
const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const visionToolkit = metadata.dsh?.visionToolkit;
/** Plugin package version. */
export const PLUGIN_VERSION = metadata.version;
/** Pinned upstream repository URL. */
export const UPSTREAM_REPOSITORY = visionToolkit?.upstreamRepository ?? 'https://github.com/Anionex/agent-vision-toolkit';
/** Pinned upstream release tag. */
export const UPSTREAM_VERSION = visionToolkit?.upstreamVersion ?? 'v0.1.0+snapshot.c27d1a3';
/** Pinned upstream source commit. */
export const UPSTREAM_COMMIT = visionToolkit?.upstreamCommit ?? 'c27d1a300962b553c0884993c575cd3e819465ce';
//# sourceMappingURL=version.js.map