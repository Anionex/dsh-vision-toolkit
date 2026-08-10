import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

// The plugin is an out-of-tree bundle: tests reuse the harness monorepo's
// source-resolution facade so `@deepseek-ai/*` imports resolve to src, while
// the published package keeps bare package-name imports resolved by the host.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../tsconfig.base.json'] })],
  resolve: {
    alias: [
      { find: /^react$/, replacement: resolve(ROOT, '../packages/client/ui-primitives/node_modules/react/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: resolve(ROOT, '../packages/client/ui-primitives/node_modules/react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(ROOT, '../packages/client/ui-primitives/node_modules/react/jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: resolve(ROOT, '../packages/client/ui-primitives/node_modules/react-dom/index.js') },
      { find: /^react-dom\/client$/, replacement: resolve(ROOT, '../packages/client/ui-primitives/node_modules/react-dom/client.js') },
      { find: /^@testing-library\/react$/, replacement: resolve(ROOT, '../packages/client/ui-tool/node_modules/@testing-library/react/dist/index.js') },
    ],
  },
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
