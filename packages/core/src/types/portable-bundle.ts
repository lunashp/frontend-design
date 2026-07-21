/**
 * The self-contained, copy-ready output for a component: a folder of files
 * (a virtual FileMap) plus the external deps the destination project must install.
 */

/** Bundle-relative path (e.g. `/Button.tsx`) -> file contents. */
export type FileMap = Readonly<Record<string, string>>;

export type AssetEncoding = 'file' | 'data-url';

export interface AssetRef {
  /** Bundle-relative path. */
  readonly path: string;
  readonly encoding: AssetEncoding;
  /** Absolute source path in the target project. */
  readonly sourcePath: string;
}

export interface PortableBundle {
  readonly files: FileMap;
  /** Entry file within `files`, e.g. `/Button.tsx`. */
  readonly entryPath: string;
  /** External npm deps to install in the destination: name -> version range. */
  readonly externalDeps: Readonly<Record<string, string>>;
  readonly assets: readonly AssetRef[];
  /** Human-readable cutoffs/decisions, e.g. "left <DataTable> as external boundary". */
  readonly warnings: readonly string[];
  /** True when the bundle has unresolved local imports (dropped/truncated files). */
  readonly incomplete?: boolean;
  /**
   * The app's real theme, bundled in for a faithful preview. Bundle-relative
   * path + export name, so the provider can `import { <export> } from <path>`.
   */
  readonly previewTheme?: { readonly path: string; readonly exportName: string };
  /** Bundle-relative path of a bundled i18n message catalogue, if included. */
  readonly previewMessages?: string;
  /**
   * Self-contained context providers the component consumes (their module is
   * already bundled) — the preview wraps the component in each so hooks like
   * `useChatPanel` find their context instead of throwing.
   */
  readonly previewProviders?: readonly { readonly path: string; readonly exportName: string }[];
}
