/**
 * Builds the React adapter's program handle: a ts-morph `Project` for structural
 * analysis plus a lazily-created react-docgen-typescript parser for prop metadata.
 * ts-morph is used read-only — we never call `.save()` on a target project.
 */

import { Project } from 'ts-morph';
import ts from 'typescript';
import * as rdt from 'react-docgen-typescript';
import type { LoadedProject } from '../../types/project.js';

export interface ReactProgramHandle {
  readonly tsProject: Project;
  readonly loaded: LoadedProject;
  readonly isNext: boolean;
  /** Lazily-created, cached react-docgen-typescript parser. */
  docgen(): rdt.FileParser;
  /**
   * The ts-morph project's underlying `ts.Program`. Handed to docgen's
   * `parseWithProgramProvider` so prop extraction reuses this one program
   * instead of building a fresh one per component — `parse()` calls
   * `ts.createProgram` every time, which was ~99% of a scan's wall clock.
   */
  tsProgram(): ts.Program;
}

const DOCGEN_OPTIONS: rdt.ParserOptions = {
  savePropValueAsString: true,
  shouldExtractLiteralValuesFromEnum: true,
  shouldRemoveUndefinedFromOptional: true,
  shouldIncludePropTagMap: true,
  // Drop props inherited from node_modules (e.g. DOM ButtonHTMLAttributes) so a
  // component's control panel shows only its own props.
  //
  // CAVEAT — this filters almost nothing in practice, so do NOT read it as the
  // own/inherited split. `prop.parent` is undefined for every prop of a real MUI
  // wrapper (measured: 0/63 CustomAvatar, 0/64 CustomChip, 0/82 CustomTextField):
  // docgen only fills `parent` when a prop's declaration sits directly inside an
  // interface/type-alias node, and MUI's props arrive via mapped + intersection
  // types whose members never do. The split that DOES work is computed from the
  // TypeScript checker in extract-props.ts (`PropControl.origin`). This stays
  // because it is still correct whenever `parent` happens to be populated.
  propFilter: (prop) => !prop.parent || !/node_modules/.test(prop.parent.fileName),
};

// Include JS variants too — a .tsx component may import a local .js/.jsx sibling;
// those must be in the program so they get bundled instead of dangling.
const SOURCE_GLOBS = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];
const IGNORE_GLOBS = ['**/*.d.ts', '**/*.test.*', '**/*.spec.*', '**/*.stories.*'];

export function createReactProgram(loaded: LoadedProject): ReactProgramHandle {
  const tsProject = loaded.tsconfigPath
    ? new Project({
        tsConfigFilePath: loaded.tsconfigPath,
        skipAddingFilesFromTsConfig: true,
      })
    : new Project({
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          allowJs: true,
        },
      });

  for (const dir of loaded.srcDirs) {
    const globs = [
      ...SOURCE_GLOBS.map((g) => `${dir}/${g}`),
      ...IGNORE_GLOBS.map((g) => `!${dir}/${g}`),
      `!${dir}/**/node_modules/**`,
    ];
    tsProject.addSourceFilesAtPaths(globs);
  }

  const isNext = Boolean(loaded.pkg.dependencies['next'] ?? loaded.pkg.devDependencies['next']);

  let parser: rdt.FileParser | null = null;
  return {
    tsProject,
    loaded,
    isNext,
    tsProgram() {
      // ts-morph memoizes the created ts.Program and only rebuilds it when a
      // source file changes; the target is read-only, so this costs one
      // `ts.createProgram` per session. The two `ts` copies (ours vs the one
      // ts-morph bundles) are structurally identical but nominally distinct.
      return tsProject.getProgram().compilerObject as unknown as ts.Program;
    },
    docgen() {
      if (parser) return parser;
      // The compiler options are vestigial: every call goes through
      // `parseWithProgramProvider`, which ignores them and uses `tsProgram()`.
      // They are taken from the ts-morph project (which already resolved the
      // target's tsconfig) so the fallback matches the program we hand over,
      // and so a malformed tsconfig can no longer throw here a second time.
      parser = rdt.withCompilerOptions(
        tsProject.getCompilerOptions() as unknown as ts.CompilerOptions,
        DOCGEN_OPTIONS,
      );
      return parser;
    },
  };
}
