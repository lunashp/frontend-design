/**
 * Inlines a binary asset (image / font) an entry imports, as a data-URI module,
 * so the bundle is SELF-CONTAINED — no separate binary file to ship, and no
 * dangling `import logo from './logo.png'` that would otherwise mark the whole
 * bundle incomplete and force the component to code-only.
 *
 * WHY a `.ts` module rather than the raw bytes: the bundle's `FileMap` is
 * string-only, and both consumers resolve `./logo.png` to `./logo.png.ts` by
 * extension the same way —
 *   - the preview's esbuild appends its resolve-extensions when `./logo.png`
 *     itself isn't a file, and
 *   - `findDanglingImports` checks `<path> + '.ts'` in exactly the same set.
 * So the ORIGINAL import specifier is left untouched; adding the module at
 * `bundlePathOf(asset) + '.ts'` is all it takes. `export default "<dataURI>"`
 * makes `import logo from './logo.png'` yield the URL string, which is what the
 * code already expected from a bundler's asset loader.
 *
 * Cap: base64 inflates ~33%, and a bundle is shipped to the browser and rebuilt
 * by esbuild on every preview, so an oversized asset would bloat both. Over the
 * cap the asset is skipped (with a warning) and the component keeps whatever
 * behaviour it had before inlining existed.
 */

import * as path from 'node:path';
import type { Buffer } from 'node:buffer';
import type { ReadOnlyFs } from '../util/fs-readonly.js';

/** Raw-byte ceiling for inlining a single asset. */
export const MAX_INLINE_ASSET_BYTES = 256 * 1024;

/** Extension → MIME. Only types we can meaningfully embed as a data URI. `.json`
 *  is intentionally absent: it is copied into the bundle verbatim elsewhere and
 *  imported natively, never inlined as a URL. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/** The MIME type for an asset path, or null when it is not an inlinable type. */
export function assetMime(file: string): string | null {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] ?? null;
}

/** The JS module source that default-exports the data URI. */
export function assetModuleSource(dataUri: string): string {
  return (
    '// Inlined asset — the binary was embedded as a data URI so the bundle is\n' +
    '// self-contained (no separate file to copy, and no dangling import).\n' +
    `export default ${JSON.stringify(dataUri)};\n`
  );
}

/** The bundle path of the inlined-asset module: the asset's own bundle path with
 *  a `.ts` suffix, so `./logo.png` resolves to `./logo.png.ts` by extension. */
export function assetModuleKey(assetBundlePath: string): string {
  return `${assetBundlePath}.ts`;
}

export type InlineResult = { readonly source: string } | { readonly skip: string };

/**
 * Read an asset and produce its data-URI module source, or a `skip` reason
 * (unsupported type, unreadable, or over the size cap) for a warning. Never
 * throws — a failure to inline one asset must not fail the whole resolve.
 */
export function inlineAssetFile(abs: string, rofs: ReadOnlyFs): InlineResult {
  const mime = assetMime(abs);
  if (!mime) return { skip: `unsupported asset type: ${path.basename(abs)}` };
  let bytes: Buffer;
  try {
    bytes = rofs.readBytesSync(abs);
  } catch {
    return { skip: `could not read asset: ${path.basename(abs)}` };
  }
  if (bytes.length > MAX_INLINE_ASSET_BYTES) {
    const kb = Math.round(bytes.length / 1024);
    return { skip: `asset too large to inline (${kb}KB): ${path.basename(abs)}` };
  }
  return { source: assetModuleSource(`data:${mime};base64,${bytes.toString('base64')}`) };
}
