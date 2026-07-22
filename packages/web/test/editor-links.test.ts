import { describe, it, expect } from 'vitest';
import {
  EDITORS,
  editorLinks,
  editorUrl,
  formatLocation,
  relativePath,
} from '../src/lib/editor-links.js';
import type { SourceLocation } from '../src/api/types.js';

const LOC: SourceLocation = { file: '/Users/dev/app/src/ui/Button.tsx', line: 42, column: 7 };

describe('editorUrl', () => {
  it('builds the scheme://file<path>:line:column form for VS Code and friends', () => {
    expect(editorUrl('vscode', LOC)).toBe('vscode://file/Users/dev/app/src/ui/Button.tsx:42:7');
    expect(editorUrl('cursor', LOC)).toBe('cursor://file/Users/dev/app/src/ui/Button.tsx:42:7');
    expect(editorUrl('vscode-insiders', LOC)).toBe(
      'vscode-insiders://file/Users/dev/app/src/ui/Button.tsx:42:7',
    );
    expect(editorUrl('zed', LOC)).toBe('zed://file/Users/dev/app/src/ui/Button.tsx:42:7');
  });

  it('uses JetBrains query-param form for WebStorm', () => {
    expect(editorUrl('webstorm', LOC)).toBe(
      'webstorm://open?file=%2FUsers%2Fdev%2Fapp%2Fsrc%2Fui%2FButton.tsx&line=42&column=7',
    );
  });

  it('percent-encodes spaces and URL-significant characters in the path', () => {
    const url = editorUrl('vscode', { file: '/a b/c#d?e/F.tsx', line: 1, column: 1 });
    expect(url).toBe('vscode://file/a%20b/c%23d%3Fe/F.tsx:1:1');
  });

  it('normalizes a Windows path to a leading-slash posix path', () => {
    expect(editorUrl('vscode', { file: 'C:\\proj\\src\\A.tsx', line: 3, column: 4 })).toBe(
      'vscode://file/C:/proj/src/A.tsx:3:4',
    );
  });

  it('clamps out-of-range or non-finite positions to 1', () => {
    expect(editorUrl('vscode', { file: '/a.tsx', line: 0, column: -3 })).toBe(
      'vscode://file/a.tsx:1:1',
    );
    expect(editorUrl('vscode', { file: '/a.tsx', line: NaN, column: 2.9 })).toBe(
      'vscode://file/a.tsx:1:2',
    );
  });
});

describe('editorLinks', () => {
  it('returns one labelled link per supported editor, in order', () => {
    const links = editorLinks(LOC);
    expect(links.map((l) => l.id)).toEqual([...EDITORS]);
    expect(links.every((l) => l.label.length > 0)).toBe(true);
    expect(links.every((l) => l.url.includes('42'))).toBe(true);
  });
});

describe('formatLocation', () => {
  it('is the copyable absolute path:line:column fallback', () => {
    expect(formatLocation(LOC)).toBe('/Users/dev/app/src/ui/Button.tsx:42:7');
  });

  it('clamps bad positions the same way the URLs do', () => {
    expect(formatLocation({ file: '/a.tsx', line: 0, column: 0 })).toBe('/a.tsx:1:1');
  });
});

describe('relativePath', () => {
  it('strips the project root and its separator', () => {
    expect(relativePath('/Users/dev/app', '/Users/dev/app/src/ui/Button.tsx')).toBe(
      'src/ui/Button.tsx',
    );
  });

  it('returns the path unchanged when it is outside the root, or the root is empty', () => {
    expect(relativePath('/Users/dev/app', '/elsewhere/A.tsx')).toBe('/elsewhere/A.tsx');
    expect(relativePath('', '/elsewhere/A.tsx')).toBe('/elsewhere/A.tsx');
  });
});
