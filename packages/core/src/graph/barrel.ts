/**
 * Traces named imports past barrel files to the module that actually declares
 * each symbol.
 *
 * A barrel (`export * from './CloseIcon'` × 200) is one module specifier but an
 * enormous subtree. Following the specifier drags every re-exported file into a
 * component's bundle, which blows the file budget and leaves the bundle
 * incomplete — so the component cannot render at all. Following the *symbol*
 * lands on the single file that declares it.
 */

import type { ImportDeclaration } from 'ts-morph';
import type { LoadedProject } from '../types/project.js';
import { isInProjectSrc } from './resolve-module.js';

export interface TracedBinding {
  /** Text to re-emit inside the braces, e.g. `CloseIcon` or `Close as X`. */
  readonly binding: string;
  /** Absolute path of the file declaring the symbol. */
  readonly file: string;
}

/**
 * Resolve every named binding of `imp` to its declaring file.
 *
 * Returns null when the import must be followed as a whole module instead:
 * a default/namespace binding (`import X`, `import * as X` — nothing to
 * tree-shake), a side-effect import, or any binding that resolves outside the
 * project's source (an npm package or a `.d.ts`). Bailing out keeps the graph
 * and the specifier rewriter making the same decision, which is what stops a
 * rewritten import from dangling.
 */
export function traceNamedImports(
  imp: ImportDeclaration,
  loaded: LoadedProject,
): TracedBinding[] | null {
  if (imp.getDefaultImport() || imp.getNamespaceImport()) return null;

  const named = imp.getNamedImports();
  if (named.length === 0) return null;

  const traced: TracedBinding[] = [];
  for (const spec of named) {
    const symbol = spec.getNameNode().getSymbol();
    if (!symbol) return null;
    // A barrel re-export makes the local symbol an alias; the aliased symbol is
    // declared in the origin file. A direct import has no alias to follow.
    const declared = symbol.getAliasedSymbol() ?? symbol;
    const file = declared.getDeclarations()[0]?.getSourceFile().getFilePath();
    if (!file || file.endsWith('.d.ts') || !isInProjectSrc(file, loaded)) return null;
    traced.push({ binding: spec.getText(), file });
  }
  return traced;
}

/** Group traced bindings by declaring file, preserving encounter order. */
export function groupByFile(traced: readonly TracedBinding[]): Map<string, TracedBinding[]> {
  const groups = new Map<string, TracedBinding[]>();
  for (const t of traced) {
    const list = groups.get(t.file);
    if (list) list.push(t);
    else groups.set(t.file, [t]);
  }
  return groups;
}
