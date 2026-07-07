/** Shared ts-morph helpers for React component analysis. */

import { Node, SyntaxKind } from 'ts-morph';
import type { ExportedDeclarations } from 'ts-morph';
import type { ComponentDescriptor } from '../../types/component.js';
import type { ReactProgramHandle } from './ts-program.js';

export const JSX_KINDS = [
  SyntaxKind.JsxElement,
  SyntaxKind.JsxSelfClosingElement,
  SyntaxKind.JsxFragment,
] as const;

export function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

export function containsJsx(node: Node): boolean {
  for (const kind of JSX_KINDS) {
    if (node.getFirstDescendantByKind(kind)) return true;
  }
  return (
    Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node) || Node.isJsxFragment(node)
  );
}

/** The node holding the component body (function/arrow/class/HOC call), if any. */
export function componentBodyOf(decl: ExportedDeclarations): Node | null {
  if (
    Node.isFunctionDeclaration(decl) ||
    Node.isArrowFunction(decl) ||
    Node.isFunctionExpression(decl)
  ) {
    return decl;
  }
  if (Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init;
    if (init && Node.isCallExpression(init)) return init; // React.memo / forwardRef(...)
    return null;
  }
  if (Node.isClassDeclaration(decl)) return decl;
  return null;
}

/** Re-resolve a descriptor's declaration node in the program. */
export function findComponentDeclaration(
  handle: ReactProgramHandle,
  descriptor: ComponentDescriptor,
): ExportedDeclarations | null {
  const sf = handle.tsProject.getSourceFile(descriptor.filePath);
  if (!sf) return null;
  const decls = sf.getExportedDeclarations().get(descriptor.exportName);
  return decls?.[0] ?? null;
}
