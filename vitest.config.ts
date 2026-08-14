import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Exercise the published DSH prerelease packages rather than a neighboring
// Harness checkout, because this bundle is installed from its own repository.
export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(
        new URL('./tests/client-ui-primitives-stub.tsx', import.meta.url),
      ),
    },
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
