/**
 * Discovers React UI components in the ts-morph program. A component is an
 * exported PascalCase function/arrow/class whose body contains JSX. Re-exports
 * resolve to their original declaration, so barrel files don't create duplicates.
 */

import { Node } from 'ts-morph';
import type { ExportedDeclarations, SourceFile } from 'ts-morph';
import type { ComponentDescriptor } from '../../types/component.js';
import { shortHash } from '../../util/paths.js';
import type { ReactProgramHandle } from './ts-program.js';
import { componentBodyOf, containsJsx, isPascalCase } from './node-utils.js';

function declaredName(decl: ExportedDeclarations, exportName: string): string {
  if (
    (Node.isFunctionDeclaration(decl) || Node.isClassDeclaration(decl)) &&
    decl.getName()
  ) {
    return decl.getName() as string;
  }
  if (Node.isVariableDeclaration(decl)) return decl.getName();
  return exportName;
}

function isExcludedFile(sf: SourceFile): boolean {
  const p = sf.getFilePath();
  return (
    p.includes('/node_modules/') ||
    p.endsWith('.d.ts') ||
    /\.(test|spec|stories)\.[tj]sx?$/.test(p)
  );
}

export function componentId(filePath: string, exportName: string): string {
  return `${shortHash(`${filePath}#${exportName}`, 10)}`;
}

export function discoverComponents(handle: ReactProgramHandle): ComponentDescriptor[] {
  const seen = new Map<string, ComponentDescriptor>();

  for (const sf of handle.tsProject.getSourceFiles()) {
    if (isExcludedFile(sf)) continue;

    let exported: ReadonlyMap<string, ExportedDeclarations[]>;
    try {
      exported = sf.getExportedDeclarations();
    } catch {
      continue; // malformed file — skip rather than fail the whole scan
    }

    for (const [exportName, decls] of exported) {
      for (const decl of decls) {
        const name = declaredName(decl, exportName);
        if (!isPascalCase(name)) continue;

        const body = componentBodyOf(decl);
        if (!body || !containsJsx(body)) continue;

        const originFile = decl.getSourceFile();
        if (isExcludedFile(originFile)) continue;

        const filePath = originFile.getFilePath();
        const id = componentId(filePath, exportName);
        if (seen.has(id)) continue;

        const start = decl.getStart();
        const { line, column } = originFile.getLineAndColumnAtPos(start);
        seen.set(id, {
          id,
          name,
          filePath,
          exportName,
          isDefaultExport: exportName === 'default',
          loc: { file: filePath, line, column },
        });
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
