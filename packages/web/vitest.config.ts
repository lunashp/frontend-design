import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The `web-dom` Vitest project: React component + hook tests that need a DOM.
 *
 * Referenced from the root config's `projects` list (not run standalone in the
 * gate), so `@vitejs/plugin-react` resolves from THIS package's node_modules —
 * pnpm keeps them isolated, so a root-level import would not find it.
 *
 * Only `.test.tsx` files run here (jsdom). The web app's pure logic lives in
 * `.test.ts` files, which the root `node` project runs without a DOM.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web-dom',
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.tsx'],
  },
});
