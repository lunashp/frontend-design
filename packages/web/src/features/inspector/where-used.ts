/**
 * Pure view mapping for the inspector's "where-used / dependencies" section — the
 * component's blast radius BEFORE you copy it. Both halves are pure so they are
 * unit-tested with no DOM.
 *
 * USED BY reads the reverse-import-graph `usage` (imports from ANALYZED SOURCE
 * only; stories/tests are outside the scan, so a component used only by stories
 * legitimately reads 0). USES reads the same bundle honesty the Portable tab
 * shows — external deps plus any unresolved/stubbed imports — summarized here so
 * dependencies are visible without leaving Details.
 */

import type { ComponentUsage, PortableBundle, StubbedModule } from '../../api/types.js';
import { relativePath } from '../../lib/editor-links.js';

export interface UsedByView {
  /** Exact importer count (never truncated). */
  readonly count: number;
  /** Project-relative importing files — a bounded SAMPLE; the count is exact. */
  readonly files: readonly string[];
  /** True when there are more importers than the listed sample. */
  readonly sampled: boolean;
  /** True when nothing in analyzed source imports it (count 0 / usage absent). */
  readonly none: boolean;
}

export interface DepView {
  readonly name: string;
  readonly version: string;
}

export interface UsesView {
  /** External packages the component needs, sorted by name. */
  readonly deps: readonly DepView[];
  /** Unresolved local imports, `<file> → <specifier>`, verbatim from the bundle. */
  readonly dangling: readonly string[];
  /** Modules swapped for local stubs, verbatim — each names the capability lost. */
  readonly stubbed: readonly StubbedModule[];
  /** No deps, no dangling, no stubs — genuinely self-contained. */
  readonly selfContained: boolean;
}

/**
 * `usage` may be undefined on hand-built summaries (a real scan always attaches
 * it). Either way an absent or zero count is the honest "no analyzed importers"
 * case, which the UI discloses rather than implying the component is unused.
 */
export function mapUsedBy(usage: ComponentUsage | undefined, projectRoot: string): UsedByView {
  const count = usage?.usedByCount ?? 0;
  const files = (usage?.usedByFiles ?? []).map((f) => relativePath(projectRoot, f));
  return { count, files, sampled: count > files.length, none: count === 0 };
}

/** The dependency-relevant slice of a bundle — all this mapping reads. */
type UsesInput = Pick<PortableBundle, 'externalDeps' | 'danglingImports' | 'stubbedModules'>;

export function mapUses(bundle: UsesInput): UsesView {
  const deps = Object.entries(bundle.externalDeps)
    .map(([name, version]) => ({ name, version }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const dangling = [...bundle.danglingImports];
  const stubbed = bundle.stubbedModules.map((s) => ({ ...s }));
  return {
    deps,
    dangling,
    stubbed,
    selfContained: deps.length === 0 && dangling.length === 0 && stubbed.length === 0,
  };
}
