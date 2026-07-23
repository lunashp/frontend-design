/**
 * Which bundle files came from the SOURCE app rather than from the component
 * itself — its theme, its i18n catalogue, its context providers.
 *
 * These files are bundled so the preview renders faithfully (wrapped in the app's
 * real theme and providers). But they sit UNMARKED in `bundle.files`: copied
 * blind into a destination project they drag the source app's whole design system
 * along with the one component, which is exactly the wrong outcome when the task
 * was "make this match OUR theme". The web surfaces them so an engineer can copy
 * the component without unknowingly importing someone else's design decisions.
 *
 * This is a pure port of the same derivation the MCP server exposes as
 * `sourceAppFiles` (packages/mcp/src/tools.ts) — kept as a browser-safe util so
 * the web app never imports the engine. It reads only the preview paths already
 * on the DTO wire (previewTheme / previewMessages / previewProviders); no host or
 * DTO change is needed.
 */

import type { PortableBundle } from '../api/types.js';

export function sourceAppFiles(bundle: PortableBundle): Set<string> {
  const paths = new Set<string>();
  if (bundle.previewTheme) paths.add(bundle.previewTheme.path);
  if (bundle.previewMessages) paths.add(bundle.previewMessages);
  for (const p of bundle.previewProviders ?? []) paths.add(p.path);
  return paths;
}

/**
 * The file set to hand to "Copy all files". Source-app files are excluded by
 * default (`includeSourceApp = false`) so the copied bundle is just the
 * component and its own tokens — not the app's design system dragged along. The
 * caller offers a labelled toggle to include them when that is genuinely wanted.
 * Returns a fresh object; the input map is never mutated.
 */
export function copyableFiles(
  files: Readonly<Record<string, string>>,
  sourceApp: ReadonlySet<string>,
  includeSourceApp: boolean,
): Record<string, string> {
  if (includeSourceApp) return { ...files };
  const out: Record<string, string> = {};
  for (const [path, code] of Object.entries(files)) {
    if (!sourceApp.has(path)) out[path] = code;
  }
  return out;
}

export interface PreviewColourSource {
  /** True when the preview renders inside the app's own theme, so its colours are real. */
  real: boolean;
  /** A one-line caption to show under the preview, stating where the colours come from. */
  caption: string;
}

/**
 * Where the preview's colours come from. Derivable purely from whether the app's
 * own theme was bundled: with a theme, the palette is the real one; without it,
 * the component renders on whatever placeholder values its own CSS declares, and
 * those must not be mistaken for the product's actual colours.
 */
export function previewColourSource(bundle: PortableBundle): PreviewColourSource {
  if (bundle.previewTheme) {
    return {
      real: true,
      caption: "Rendered with the app's real theme — these colours are faithful.",
    };
  }
  return {
    real: false,
    caption: 'Placeholder palette — these colours are the component’s own defaults, not the app’s.',
  };
}
