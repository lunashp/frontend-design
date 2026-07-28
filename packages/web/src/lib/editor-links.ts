/**
 * Jump links from a component back to its source location in a real editor.
 *
 * Two constraints shape this module. A `file://` link is blocked outright from
 * an http origin, so it is never an option. And a custom scheme (`vscode://`,
 * `cursor://`, …) fails *silently* when no handler is registered — the page
 * gets no error and no event. So a copyable `path:line:column` is not a nicety
 * here, it is the only fallback that always works; `formatLocation` exists for
 * exactly that and callers are expected to render it beside the links.
 */

import type { SourceLocation } from '../api/types.js';

export type EditorId = 'vscode' | 'vscode-insiders' | 'cursor' | 'zed' | 'webstorm';

export interface EditorLink {
  id: EditorId;
  label: string;
  url: string;
}

const EDITOR_LABEL: Record<EditorId, string> = {
  vscode: 'VS Code',
  'vscode-insiders': 'Insiders',
  cursor: 'Cursor',
  zed: 'Zed',
  webstorm: 'WebStorm',
};

/** Rendered order — commonest first. */
export const EDITORS: readonly EditorId[] = [
  'vscode',
  'cursor',
  'vscode-insiders',
  'zed',
  'webstorm',
];

/** Line/column arrive over the wire; clamp to a valid 1-based position. */
function pos(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/**
 * Normalize to the shape the `<scheme>://file<path>` handlers expect: forward
 * slashes, always leading (a Windows `C:\a\b` becomes `/C:/a/b`).
 */
function absolutePosixPath(filePath: string): string {
  const posix = filePath.replace(/\\/g, '/');
  return posix.startsWith('/') ? posix : `/${posix}`;
}

/** Percent-encode a path for a URL, including the two chars `encodeURI` keeps. */
function encodePath(filePath: string): string {
  return encodeURI(filePath).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

/** `<absolute path>:<line>:<column>` — the copyable, never-failing fallback. */
export function formatLocation(loc: SourceLocation): string {
  return `${loc.file}:${pos(loc.line)}:${pos(loc.column)}`;
}

/** Strip the project root from an absolute path, for display. */
export function relativePath(projectRoot: string, filePath: string): string {
  if (!projectRoot || !filePath.startsWith(projectRoot)) return filePath;
  return filePath.slice(projectRoot.length).replace(/^\//, '');
}

export function editorUrl(editor: EditorId, loc: SourceLocation): string {
  const file = absolutePosixPath(loc.file);
  const line = pos(loc.line);
  const column = pos(loc.column);
  if (editor === 'webstorm') {
    // JetBrains' built-in handler takes the path as a query param, not a segment.
    return `webstorm://open?file=${encodeURIComponent(file)}&line=${line}&column=${column}`;
  }
  return `${editor}://file${encodePath(file)}:${line}:${column}`;
}

export function editorLinks(loc: SourceLocation): EditorLink[] {
  return EDITORS.map((id) => ({ id, label: EDITOR_LABEL[id], url: editorUrl(id, loc) }));
}
