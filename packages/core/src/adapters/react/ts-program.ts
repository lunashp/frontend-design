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
}

const DOCGEN_OPTIONS: rdt.ParserOptions = {
  savePropValueAsString: true,
  shouldExtractLiteralValuesFromEnum: true,
  shouldRemoveUndefinedFromOptional: true,
  shouldIncludePropTagMap: true,
  // Drop props inherited from node_modules (e.g. DOM ButtonHTMLAttributes) so a
  // component's control panel shows only its own props.
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
    docgen() {
      if (parser) return parser;
      parser = loaded.tsconfigPath
        ? rdt.withCustomConfig(loaded.tsconfigPath, DOCGEN_OPTIONS)
        : rdt.withCompilerOptions(
            { jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
            DOCGEN_OPTIONS,
          );
      return parser;
    },
  };
}
