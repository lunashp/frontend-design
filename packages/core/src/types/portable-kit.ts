/**
 * A PortableKit is the multi-component sibling of PortableBundle: a SET of
 * components extracted together into ONE self-contained folder that shares a
 * single token namespace.
 *
 * The product's endpoint is "harvest a set of components into our repo". Building
 * each component's bundle separately and concatenating them by hand corrupts the
 * result — every single-component bundle restarts its token counters at
 * `--color-1`, so assembling a set collides token names, and a file shared by two
 * components (a common Button) is duplicated or path-collided. The kit resolves
 * the whole set as one graph: one commonBaseDir, one tokenization, one dependency
 * merge — so shared files appear once and shared values get one name.
 */

import type { FileMap, StubbedModule } from './portable-bundle.js';
import type { TokenModel } from './token-model.js';

/** One component within a kit: its id, name, and entry file path in `files`. */
export interface KitComponent {
  readonly id: string;
  readonly name: string;
  /** Entry file within `files`, e.g. `/src/components/Card/Card.tsx`. */
  readonly entryPath: string;
}

/** One component's stated version range for a package involved in a conflict. */
export interface DepRequirement {
  readonly componentId: string;
  readonly range: string;
}

/**
 * A package that two or more components in the kit require at DIFFERENT version
 * ranges. Recorded rather than silently resolved to one range, so the caller can
 * reconcile it (e.g. one component imports it directly at `latest`, another pulls
 * it in as an installed peer at `^3.1.0`).
 */
export interface DepConflict {
  readonly package: string;
  readonly requirements: readonly DepRequirement[];
}

export interface PortableKit {
  /** The merged, copy-ready folder for the whole set (imports rewritten). */
  readonly files: FileMap;
  /** componentId -> its entry file path within `files`. */
  readonly entryPaths: Readonly<Record<string, string>>;
  /** Components in the kit, in the order they were requested. */
  readonly components: readonly KitComponent[];
  /** Merged external npm deps to install: name -> version range. */
  readonly externalDeps: Readonly<Record<string, string>>;
  /** Packages required at conflicting ranges across the set. */
  readonly depConflicts: readonly DepConflict[];
  /** Bundle-relative path of the single shared token stylesheet. */
  readonly tokensCssPath: string;
  /** The one shared `:root { … }` token stylesheet for the whole set. */
  readonly tokensCss: string;
  /** The shared token model over the whole kit. */
  readonly tokenModel: TokenModel;
  /** Modules replaced by local stubs across the set, deduped, and what each costs. */
  readonly stubbedModules: readonly StubbedModule[];
  /** Every unresolved local import across the set, as `<file> → <specifier>`. */
  readonly danglingImports: readonly string[];
  /** Human-readable cutoffs/decisions, deduped across the set. */
  readonly warnings: readonly string[];
  /**
   * The app's real theme, bundled in for a faithful preview (single per project,
   * so unambiguous for a kit). Bundle-relative path + export name.
   */
  readonly previewTheme?: { readonly path: string; readonly exportName: string };
  /** Bundle-relative path of a bundled i18n message catalogue, if included. */
  readonly previewMessages?: string;
  /** Self-contained context providers any component in the set consumes. */
  readonly previewProviders?: readonly { readonly path: string; readonly exportName: string }[];
}
