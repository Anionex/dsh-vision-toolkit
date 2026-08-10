import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// The plugin is an out-of-tree bundle: tests reuse the harness monorepo's
// source-resolution facade so `@deepseek-ai/*` imports resolve to src, while
// the published package keeps bare package-name imports resolved by the host.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../tsconfig.base.json'] })],
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // Runtime-install tests temporarily own process-wide DSH_HOME, while the
    // real-profile acceptance launches `dsh` children from that environment.
    // File parallelism would make their isolation depend on Vitest's worker
    // implementation and can strand a managed-runtime child during teardown.
    fileParallelism: false,
  },
})
