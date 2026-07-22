/**
 * An in-memory ReactProgramHandle, so discovery/signal tests can state the
 * exact source they are about instead of routing everything through a fixture
 * on disk. The ts-morph project is real; only the filesystem is virtual.
 */

import { Project } from 'ts-morph';
import ts from 'typescript';
import type * as rdt from 'react-docgen-typescript';
import type { LoadedProject } from '../../src/types/project.js';
import type { ReactProgramHandle } from '../../src/adapters/react/ts-program.js';

const LOADED: LoadedProject = {
  rootPath: '/proj',
  srcDirs: ['/proj/src'],
  tsconfigPath: null,
  pathAliases: { baseUrl: null, paths: {} },
  pkg: { name: 'proj', dependencies: {}, devDependencies: {} },
  framework: 'react',
  workspaceDir: '/ws',
  themeRef: null,
  messagesFile: null,
  contextProviders: [],
};

export interface InMemoryOptions {
  readonly isNext?: boolean;
  /** Docs the fake docgen parser should return, keyed by file path. */
  readonly docs?: Readonly<Record<string, rdt.ComponentDoc[]>>;
}

export interface InMemoryHandle {
  readonly handle: ReactProgramHandle;
  /** File paths passed to the parser, and which entry point was used. */
  readonly calls: { parse: string[]; withProvider: string[]; programs: number };
}

export function inMemoryHandle(
  files: Readonly<Record<string, string>>,
  options: InMemoryOptions = {},
): InMemoryHandle {
  const tsProject = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, allowJs: true },
  });
  for (const [filePath, text] of Object.entries(files)) {
    tsProject.createSourceFile(filePath, text, { overwrite: true });
  }

  const calls = { parse: [] as string[], withProvider: [] as string[], programs: 0 };
  const docsFor = (filePath: string): rdt.ComponentDoc[] => options.docs?.[filePath] ?? [];
  const parser: rdt.FileParser = {
    parse(filePathOrPaths) {
      const p = String(filePathOrPaths);
      calls.parse.push(p);
      return docsFor(p);
    },
    parseWithProgramProvider(filePathOrPaths, programProvider) {
      const p = String(filePathOrPaths);
      calls.withProvider.push(p);
      programProvider?.();
      return docsFor(p);
    },
  };

  const handle: ReactProgramHandle = {
    tsProject,
    loaded: LOADED,
    isNext: options.isNext ?? false,
    docgen: () => parser,
    tsProgram() {
      calls.programs += 1;
      return tsProject.getProgram().compilerObject as unknown as ts.Program;
    },
  };

  return { handle, calls };
}
