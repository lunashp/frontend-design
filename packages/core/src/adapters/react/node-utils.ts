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

/**
 * A `styled.div\`…\`` / `styled(Button)\`…\`` / `styled.a.attrs({})\`…\`` tag.
 * Covers styled-components and emotion, which share the call shape. These carry
 * no JSX at all, so discovery has to recognise them structurally or a
 * styled-components codebase scans to an empty gallery.
 */
export function isStyledFactory(node: Node): boolean {
  if (!Node.isTaggedTemplateExpression(node)) return false;
  return /^styled\s*[.(]/.test(node.getTag().getText());
}

/** The node holding the component body (function/arrow/class/HOC call/styled tag), if any. */
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
    if (init && isStyledFactory(init)) return init;
    return null;
  }
  if (Node.isClassDeclaration(decl)) return decl;
  return null;
}

/**
 * A component name derived from the file path, for exports that carry no usable
 * identifier of their own (`export default () => <span/>`). `Hero.tsx` → `Hero`,
 * `hero-banner.tsx` → `HeroBanner`, and a bare `index.tsx` falls back to its
 * directory so every component in a folder-per-component tree isn't "Index".
 */
export function nameFromFilePath(filePath: string): string | null {
  const segments = filePath.split('/').filter(Boolean);
  const base = (segments.pop() ?? '').replace(/\.[^.]+$/, '');
  const raw = /^index$/i.test(base) ? (segments.pop() ?? '') : base;
  const pascal = raw
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return isPascalCase(pascal) ? pascal : null;
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
