/**
 * Renders a component's Sandpack spec into a self-contained preview document by
 * bundling it locally with esbuild against the TARGET project's own
 * node_modules — no external CDN (jsdelivr / codesandbox.io) involved. This is
 * what makes the design actually appear regardless of network, browser
 * extensions, or CDN availability.
 *
 * The target is still read strictly read-only: esbuild only resolves and reads
 * from its node_modules; nothing is written back to the project.
 */

import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SandpackSpec } from '@ce/core';

export interface PreviewInput {
  readonly targetRoot: string;
  readonly spec: SandpackSpec;
}

/** Resolve `/foo` sandbox-root specifiers to the temp bundle dir. */
function sandboxRootPlugin(dir: string) {
  return {
    name: 'sandbox-root',
    setup(b: { onResolve: (o: { filter: RegExp }, cb: (a: { path: string }) => { path: string } | undefined) => void }) {
      b.onResolve({ filter: /^\// }, (args) => {
        const p = path.join(dir, args.path);
        return existsSync(p) ? { path: p } : undefined; // else: real FS/node_modules
      });
    },
  };
}

function escapeForScript(js: string): string {
  // Prevent a literal </script> inside the bundle from closing the tag.
  return js.replace(/<\/script>/gi, '<\\/script>');
}

/**
 * Bundle the component and return a complete HTML document that mounts it.
 * Throws with esbuild's messages if the bundle can't be built.
 */
export async function renderPreviewHtml(input: PreviewInput): Promise<string> {
  const { targetRoot, spec } = input;
  const nodeModules = path.join(targetRoot, 'node_modules');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-preview-'));
  try {
    for (const [p, content] of Object.entries(spec.files)) {
      const file = path.join(dir, p);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
    }

    const result = await build({
      entryPoints: [path.join(dir, spec.entryPath)],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      outdir: path.join(dir, '__out'),
      jsx: 'automatic',
      loader: { '.tsx': 'tsx', '.ts': 'ts', '.js': 'jsx', '.jsx': 'jsx', '.css': 'css' },
      nodePaths: [nodeModules],
      plugins: [sandboxRootPlugin(dir)],
      define: { 'process.env.NODE_ENV': '"development"' },
      logLevel: 'silent',
    });

    const js = result.outputFiles
      .filter((f) => f.path.endsWith('.js'))
      .map((f) => f.text)
      .join('\n');
    const css = result.outputFiles
      .filter((f) => f.path.endsWith('.css'))
      .map((f) => f.text)
      .join('\n');

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>html,body{margin:0}#root{padding:16px}
${css}</style>
</head>
<body>
<div id="root"></div>
<script>${escapeForScript(js)}</script>
</body>
</html>`;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
