import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config. Two projects, one config:
 *
 *  - `node`  — the pure engine (`@ce/core`), host and mcp, plus the web app's
 *    pure `.ts` logic tests. No DOM; this is the bulk of the suite and stays
 *    fast in the default node environment.
 *  - `web-dom` — React component + hook tests (`packages/web/test/**.test.tsx`),
 *    which need jsdom and the Vite React transform. Defined in the web package's
 *    own `vitest.config.ts` so it resolves `@vitejs/plugin-react` from the web
 *    package's own `node_modules` (pnpm keeps them isolated). Adding this ends
 *    the blind spot where the whole component/hook layer had no unit coverage
 *    and a real wiring regression could ship under a green suite.
 *
 * Coverage still concentrates on `@ce/core`, where the 80% gate lives; thin
 * transports and the Vite web app are covered by these tests + e2e, not the gate.
 */
export default defineConfig({
  test: {
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
    projects: [
      {
        test: {
          name: 'node',
          globals: true,
          // ts-morph/react-docgen integration tests do real compiler work;
          // generous timeout so they don't flake under coverage instrumentation.
          testTimeout: 30000,
          include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
        },
      },
      'packages/web/vitest.config.ts',
    ],
  },
});
