/**
 * Reverse import graph: for each discovered component, how many OTHER project
 * files import it (`usedByCount`) and a bounded sample of which (`usedByFiles`).
 *
 * HONESTY BAR (non-negotiable): this is a RANK / DISPLAY / tie-break signal ONLY
 * — never a reason to HIDE a component. Story/test/spec files are excluded from
 * the ts program (ts-program.ts IGNORE_GLOBS), so a design-system component used
 * ONLY by Storybook stories legitimately reads 0. Hiding by usage would delete
 * exactly the curated design system, so no such filter exists. The count means
 * "imports from analyzed source (stories/tests excluded)", nothing more.
 *
 * ATTRIBUTION is keyed by the DECLARATION, not by export name. A component
 * exported both named AND default (the Button/Badge pattern) is catalogued once
 * by discovery — under a single export name — yet must be credited whether it is
 * imported by name, through a barrel, or by default. Resolving each import to the
 * declaration node it references (file + start offset) unifies all three onto the
 * one componentId. That is why this does NOT simply call `traceNamedImports`,
 * which returns the declaring FILE only: a file can declare several components,
 * and a default import must land on the same id as the named export of the same
 * declaration — both need declaration identity, not just a filename.
 */

import type { Project, SourceFile } from 'ts-morph';
import type { ComponentDescriptor } from '../types/component.js';
import type { ComponentUsage } from '../types/artifact.js';
import type { LoadedProject } from '../types/project.js';
import { isInProjectSrc } from './resolve-module.js';

/**
 * How many importing files to list per component. `usedByCount` is exact; the
 * file list is a SAMPLE, so an atom imported by hundreds of files on a large
 * target cannot bloat the payload. The true total always rides on the count, so
 * capping the list hides nothing.
 */
const MAX_USED_BY_FILES = 10;

/** Identity of a declaration node: its file plus its start offset in that file. */
function declKey(file: string, start: number): string {
  return `${file}#${start}`;
}

/**
 * `export name -> declKey` for a module, resolving barrel re-exports to their
 * ORIGIN declaration. `getExportedDeclarations()` is the one expensive call here
 * (it binds and follows every `export … from …`), so results are memoized per
 * target: a 200-export barrel is resolved once, then every import from it is a
 * map lookup.
 */
function exportDeclKeys(target: SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, decls] of target.getExportedDeclarations()) {
    const first = decls[0];
    if (first) map.set(name, declKey(first.getSourceFile().getFilePath(), first.getStart()));
  }
  return map;
}

export function buildUsageIndex(
  project: Project,
  components: readonly ComponentDescriptor[],
  loaded: LoadedProject,
): Map<string, ComponentUsage> {
  // Memo of exportDeclKeys(target), keyed by the target's path.
  const exportsCache = new Map<string, Map<string, string>>();
  const exportsOf = (target: SourceFile): Map<string, string> => {
    const key = target.getFilePath();
    const cached = exportsCache.get(key);
    if (cached) return cached;
    const resolved = exportDeclKeys(target);
    exportsCache.set(key, resolved);
    return resolved;
  };

  // declKey -> componentId, and componentId -> its own declaration file (to drop
  // self / same-file references).
  const declKeyToId = new Map<string, string>();
  const fileById = new Map<string, string>();
  for (const c of components) {
    fileById.set(c.id, c.filePath);
    const sf = project.getSourceFile(c.filePath);
    if (!sf) continue;
    // Warms the cache for component files too, and lands on the exact declaration
    // discovery catalogued under this export name.
    const dk = exportsOf(sf).get(c.exportName);
    if (dk) declKeyToId.set(dk, c.id);
  }

  // Distinct importing files per component (a Set dedupes several imports of one
  // component from the same file — we count files, not import statements).
  const usedBy = new Map<string, Set<string>>();
  const credit = (componentId: string, importingFile: string): void => {
    if (fileById.get(componentId) === importingFile) return; // never self / same-file
    const set = usedBy.get(componentId);
    if (set) set.add(importingFile);
    else usedBy.set(componentId, new Set([importingFile]));
  };

  for (const sf of project.getSourceFiles()) {
    const importingFile = sf.getFilePath();
    // The program is built from srcDirs, but guard anyway so a stray d.ts /
    // node_modules file that slipped in never counts as an importer.
    if (!isInProjectSrc(importingFile, loaded)) continue;

    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (!target) continue; // external / unresolved — cannot be a project component
      const exports = exportsOf(target);

      // NAMED imports: `import { Button }` / `import { Foo as Bar }`. getName() is
      // the imported (export) name, so it is stable under rename-on-import; the
      // exports map already followed any barrel re-export to the origin, so
      // importing Button from a barrel credits Button, never the barrel file.
      for (const spec of imp.getNamedImports()) {
        const id = declKeyToId.get(exports.get(spec.getName()) ?? '');
        if (id) credit(id, importingFile);
      }

      // DEFAULT import: `import Button from '...'`. barrel.ts bails on these, so
      // resolve the target's `default` export to its declaration and match it —
      // which lands on the same componentId as the named export of the same
      // declaration, and follows an `export { default } from './Button'` hop
      // because getExportedDeclarations() resolves the default through it.
      if (imp.getDefaultImport()) {
        const id = declKeyToId.get(exports.get('default') ?? '');
        if (id) credit(id, importingFile);
      }

      // NAMESPACE import: `import * as X`. Which of X's members is used is
      // unknowable statically, so attribute ONLY when unambiguous: credit
      // components DECLARED IN the target file, not ones it merely re-exports.
      // A namespace import of a barrel thus inflates nothing.
      if (imp.getNamespaceImport()) {
        const targetPath = target.getFilePath();
        for (const dk of exports.values()) {
          const id = declKeyToId.get(dk);
          if (id && fileById.get(id) === targetPath) credit(id, importingFile);
        }
      }
      // Dynamic `import('...')` / `require('...')` targets are deliberately NOT
      // attributed: resolving WHICH export the call site consumes needs data-flow
      // analysis, and guessing would inflate the count. Skipped, not silently —
      // documented here as the conservative choice per the honesty bar.
    }
  }

  const index = new Map<string, ComponentUsage>();
  for (const [id, files] of usedBy) {
    const all = [...files];
    index.set(id, { usedByCount: all.length, usedByFiles: all.slice(0, MAX_USED_BY_FILES) });
  }
  return index;
}
