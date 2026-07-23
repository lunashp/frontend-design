import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { tokenizeBundle } from '../../src/tokenize/tokenization-transform.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/styled/${name}`, import.meta.url)), 'utf8');

/** True when the .tsx source has no syntactic parse errors. */
function parses(text: string): boolean {
  const sf = ts.createSourceFile('/x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return (sf.parseDiagnostics ?? []).length === 0;
}

describe('tokenizeBundle — static styled template', () => {
  const src = `import styled from 'styled-components';
export const Card = styled.div\`
  background: #7367F0;
  border-radius: 8px;
  padding: 16px;
\`;
`;
  const out = tokenizeBundle({ '/Card.tsx': src });
  const rewritten = out.files['/Card.tsx'] as string;

  it('mints a token per static themeable declaration', () => {
    const byCat = out.tokenModel.tokens.map((t) => `${t.category}:${t.value}`).sort();
    expect(byCat).toEqual(['color:#7367f0', 'radius:8px', 'spacing:16px']);
  });

  it('rewrites each literal in the .tsx copy to var(--token, <original>)', () => {
    expect(rewritten).toMatch(/background: var\(--color-1, #7367F0\)/);
    expect(rewritten).toMatch(/border-radius: var\(--radius-1, 8px\)/);
    expect(rewritten).toMatch(/padding: var\(--spacing-1, 16px\)/);
  });

  it('leaves a rewritten .tsx that still parses', () => {
    expect(parses(rewritten)).toBe(true);
  });

  it('emits those tokens into tokens.css', () => {
    expect(out.tokensCss).toContain('--color-1: #7367f0;');
    expect(out.tokensCss).toContain('--radius-1: 8px;');
    expect(out.tokensCss).toContain('--spacing-1: 16px;');
  });

  it('points usages at the .tsx file and line', () => {
    const color = out.tokenModel.tokens.find((t) => t.category === 'color');
    expect(color?.usages[0]?.file).toBe('/Card.tsx');
    expect(color?.usages[0]?.property).toBe('background');
    expect(color?.usages[0]?.line).toBe(3);
  });

  it('marks styled-derived tokens as re-themeable (extracted)', () => {
    expect(out.tokenModel.tokens.every((t) => t.source === 'extracted')).toBe(true);
  });
});

describe('tokenizeBundle — interpolation adjacent to a static literal', () => {
  const src = `import styled from 'styled-components';
const Base = styled.button\`\`;
export const T = styled(Base)\`
  color: #7367F0;
  padding: \${(p) => (p.big ? '16px' : '8px')};
  margin-top: 4px;
\`;
`;
  const out = tokenizeBundle({ '/T.tsx': src });
  const rewritten = out.files['/T.tsx'] as string;

  it('tokenizes the static declarations on either side', () => {
    const cats = out.tokenModel.tokens.map((t) => t.category).sort();
    expect(cats).toEqual(['color', 'spacing']);
    expect(rewritten).toMatch(/color: var\(--color-1, #7367F0\)/);
    expect(rewritten).toMatch(/margin-top: var\(--spacing-1, 4px\)/);
  });

  it('skips the declaration whose value touches the interpolation', () => {
    // The dynamic padding is NOT tokenized...
    expect(out.tokenModel.tokens.some((t) => t.usages.some((u) => u.property === 'padding'))).toBe(
      false,
    );
    // ...and its interpolation is left BYTE-INTACT (regex avoids a literal `${`).
    expect(rewritten).toMatch(/padding: \$\{\(p\) => \(p\.big \? '16px' : '8px'\)\};/);
  });

  it('leaves a rewritten .tsx that still parses', () => {
    expect(parses(rewritten)).toBe(true);
  });
});

describe('tokenizeBundle — emotion css template', () => {
  const src = `import { css } from '@emotion/react';
export const badge = css\`
  background: #ede9fe;
  border-radius: 6px;
\`;
`;
  const out = tokenizeBundle({ '/badge.tsx': src });
  const rewritten = out.files['/badge.tsx'] as string;

  it('tokenizes an emotion css literal the same way', () => {
    expect(out.tokenModel.tokens.map((t) => t.category).sort()).toEqual(['color', 'radius']);
    expect(rewritten).toMatch(/background: var\(--color-1, #ede9fe\)/);
    expect(rewritten).toMatch(/border-radius: var\(--radius-1, 6px\)/);
    expect(parses(rewritten)).toBe(true);
  });
});

describe('tokenizeBundle — shared namespace with a CSS file', () => {
  const out = tokenizeBundle({
    '/theme.module.css': '.wrapper { background: #7367f0; }',
    '/Card.tsx': `import styled from 'styled-components';
export const Card = styled.div\`background: #7367F0;\`;
`,
  });

  it('gives a value shared by a stylesheet and a styled template ONE token name', () => {
    const brand = out.tokenModel.tokens.filter((t) => t.value === '#7367f0');
    expect(brand).toHaveLength(1);
    expect(brand[0]?.usages).toHaveLength(2);
    const files = brand[0]?.usages.map((u) => u.file).sort();
    expect(files).toEqual(['/Card.tsx', '/theme.module.css']);
    // Both call sites reference the same var name.
    const name = brand[0]?.name;
    expect(out.files['/theme.module.css']).toContain(`var(${name}, #7367f0)`);
    expect(out.files['/Card.tsx']).toContain(`var(${name}, #7367F0)`);
  });
});

describe('tokenizeBundle — plain CSS bundle is byte-for-byte unchanged', () => {
  it('does not touch a bundle with no styled templates', () => {
    const css = '.a { color: #3b82f6; }';
    const tsx = 'export const A = () => null;';
    const out = tokenizeBundle({ '/a.css': css, '/A.tsx': tsx });
    // The .tsx has no styled template, so it passes through verbatim.
    expect(out.files['/A.tsx']).toBe(tsx);
  });
});

describe('tokenizeBundle — realistic styled fixture', () => {
  const out = tokenizeBundle({
    '/Widgets.tsx': fixture('Widgets.tsx'),
    '/theme.module.css': fixture('theme.module.css'),
  });
  const rewritten = out.files['/Widgets.tsx'] as string;

  it('tokenizes static styled/emotion values with write-back and skips the dynamic one', () => {
    // #7367f0 (Card.background, Toggle.color, theme .wrapper) collapses to one token.
    const brand = out.tokenModel.tokens.filter((t) => t.value === '#7367f0');
    expect(brand).toHaveLength(1);
    expect(brand[0]?.usages).toHaveLength(3);
    // Dynamic padding is skipped; static margin-top is not.
    expect(out.tokenModel.tokens.some((t) => t.usages.some((u) => u.property === 'padding'))).toBe(
      true, // Card's static padding: 16px IS tokenized
    );
    expect(rewritten).toMatch(/padding: \$\{\(props\) => \(props\.big \? '16px' : '8px'\)\};/);
  });

  it('keeps the rewritten fixture parseable and carries a var() reference', () => {
    expect(parses(rewritten)).toBe(true);
    expect(rewritten).toMatch(/var\(--/);
  });
});
