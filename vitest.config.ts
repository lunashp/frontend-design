import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config. Coverage is concentrated on the pure engine (`@ce/core`),
 * where the 80% line + branch gate lives. Thin transports (host/mcp) and the
 * Vite web app are covered by smoke/e2e tests rather than unit coverage.
 */
export default defineConfig({
  test: {
    globals: true,
    // ts-morph/react-docgen integration tests do real compiler work; generous
    // timeout so they don't flake under coverage instrumentation.
    testTimeout: 30000,
    include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/core/src/**/*.ts'],
      exclude: [
        'packages/core/src/**/*.test.ts',
        'packages/core/src/types/**',
        'packages/core/src/index.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
