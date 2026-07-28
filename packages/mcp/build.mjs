/**
 * Build a self-contained, publishable server. Bundles the first-party engine
 * (@ce/core) + this package's source into one ESM file, and keeps every
 * third-party package external (declared in package.json `dependencies`, so npm
 * installs them on the consumer side). Node built-ins stay external too.
 *
 * Third-party deps are NOT bundled on purpose: ts-morph / dependency-cruiser /
 * react-docgen-typescript etc. do dynamic requires and ship their own runtime,
 * and the MCP SDK is ESM-only — leaving them external lets Node's own resolver
 * handle interop, exactly as the tsx dev entry already does.
 */

import { build } from 'esbuild';

const bundleFirstPartyOnly = {
  name: 'bundle-first-party-only',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return undefined;
      const p = args.path;
      // Bundle relative/absolute imports and the first-party engine.
      if (
        p.startsWith('.') ||
        p.startsWith('/') ||
        p === '@ce/core' ||
        p.startsWith('@ce/core/')
      ) {
        return undefined;
      }
      // Everything else (node built-ins + third-party) stays external.
      return { path: p, external: true };
    });
  },
};

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  plugins: [bundleFirstPartyOnly],
  logLevel: 'info',
});

console.error('[build] dist/main.js written');
