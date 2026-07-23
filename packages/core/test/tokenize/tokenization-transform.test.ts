import { describe, it, expect } from 'vitest';
import { tokenizeBundle, emitTokensCss } from '../../src/tokenize/tokenization-transform.js';

const CSS = `.button {
  background: #3b82f6;
  border-radius: 8px;
  font-size: 14px;
  padding: 10px 16px;
}
.button:hover { background: #2563eb; }
.secondary { background: #3b82f6; }
`;

describe('tokenizeBundle', () => {
  const result = tokenizeBundle({
    '/src/Button.module.css': CSS,
    '/src/Button.tsx': "export const Button = () => null;",
  });

  it('extracts color and length tokens, de-duplicating equal values', () => {
    const cats = result.tokenModel.tokens.map((t) => `${t.category}:${t.value}`).sort();
    expect(cats).toEqual([
      'color:#2563eb',
      'color:#3b82f6',
      'radius:8px',
      'typography:14px',
    ]);
    // #3b82f6 used in two rules -> one token, two usages.
    const primary = result.tokenModel.tokens.find((t) => t.value === '#3b82f6');
    expect(primary?.usages).toHaveLength(2);
    // Multi-value shorthand (padding) is not tokenized.
    expect(result.tokenModel.tokens.some((t) => t.value.includes(' '))).toBe(false);
  });

  it('rewrites CSS values to var() with a literal fallback', () => {
    const css = result.files['/src/Button.module.css'] as string;
    expect(css).toMatch(/background:\s*var\(--color-1, #3b82f6\)/);
    expect(css).toMatch(/border-radius:\s*var\(--radius-1, 8px\)/);
    // A multi-value shorthand has no single themeable value -> stays literal.
    expect(css).toContain('padding: 10px 16px');
  });

  it('leaves non-CSS files untouched', () => {
    expect(result.files['/src/Button.tsx']).toBe('export const Button = () => null;');
  });

  it('emits a :root block, and applies overrides by token id', () => {
    expect(result.tokensCss).toContain(':root {');
    expect(result.tokensCss).toContain('--color-1: #3b82f6;');
    const primary = result.tokenModel.tokens.find((t) => t.value === '#3b82f6')!;
    const overridden = emitTokensCss(result.tokenModel.tokens, { [primary.id]: '#ff0000' });
    expect(overridden).toContain('--color-1: #ff0000;');
  });
});

describe('tokenizeBundle — alpha-bearing colors (Q1)', () => {
  const out = tokenizeBundle({
    '/a.css': `.overlay {
  background: rgba(0, 0, 0, 0.5);
  border-color: transparent;
  color: #3b82f6;
}
`,
  });
  const tokenValueFor = (property: string): string | undefined =>
    out.tokenModel.tokens.find((t) => t.usages.some((u) => u.property === property))?.value;

  it('keeps alpha instead of collapsing translucent colors to solid black', () => {
    // formatHex alone rendered BOTH of these as #000000, and the :root default
    // beats the var() fallback -> a copied overlay rendered opaque black.
    expect(tokenValueFor('background')).toBe('#00000080');
    expect(tokenValueFor('border-color')).toBe('transparent');
    expect(out.tokensCss).toContain('#00000080');
    expect(out.tokensCss).toContain('transparent');
  });

  it('keeps hex6 for opaque colors, so token ids only churn where alpha exists', () => {
    expect(tokenValueFor('color')).toBe('#3b82f6');
  });

  it('distinguishes two colors that differ only in alpha', () => {
    const two = tokenizeBundle({ '/a.css': '.a { color: #3b82f6; } .b { color: rgba(59,130,246,.5); }' });
    expect(two.tokenModel.tokens).toHaveLength(2);
  });
});

describe('tokenizeBundle — spacing and shadow properties (Q2)', () => {
  const out = tokenizeBundle({
    '/a.css': `.card {
  padding: 12px;
  margin-top: 4px;
  padding-inline-start: 6px;
  margin: 0 auto;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  text-shadow: none;
}
`,
  });

  it('tokenizes single-value padding/margin (incl. logical longhands)', () => {
    const spacing = out.tokenModel.tokens.filter((t) => t.category === 'spacing');
    expect(spacing.map((t) => t.value).sort()).toEqual(['12px', '4px', '6px']);
    const css = out.files['/a.css'] as string;
    expect(css).toMatch(/padding:\s*var\(--spacing-1, 12px\)/);
    expect(css).toMatch(/margin-top:\s*var\(--spacing-2, 4px\)/);
    expect(css).toMatch(/padding-inline-start:\s*var\(--spacing-3, 6px\)/);
    // `0 auto` is a shorthand with no single themeable value.
    expect(css).toContain('margin: 0 auto');
  });

  it('tokenizes shadows verbatim (the shadow category was unreachable before)', () => {
    const shadow = out.tokenModel.tokens.find((t) => t.category === 'shadow');
    expect(shadow?.value).toBe('0 1px 2px rgba(0, 0, 0, 0.1)');
    expect(out.files['/a.css']).toMatch(/box-shadow:\s*var\(--shadow-1, 0 1px 2px/);
    // `none` is a keyword, not a themeable elevation.
    expect(out.files['/a.css']).toContain('text-shadow: none');
  });

  it('never tokenizes a value that already references a variable', () => {
    const aliased = tokenizeBundle({ '/a.css': '.a { box-shadow: var(--elevation); padding: var(--gap); }' });
    expect(aliased.tokenModel.tokens).toHaveLength(0);
  });
});

describe('tokenizeBundle — author-defined custom properties (E)', () => {
  const CUSTOM = `:root {
  --primary-color: #7367F0;
  --card-radius: 10px;
  --card-gap: 8px;
  --font-body: system-ui, "Segoe UI", sans-serif;
  --card-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  --transition: all 0.2s ease;
  --alias: var(--primary-color);
}
.dark {
  --primary-color: #111827;
}
.card {
  color: var(--primary-color);
  border-radius: var(--card-radius);
}
`;
  const out = tokenizeBundle({ '/theme.css': CUSTOM });
  const byName = new Map(out.tokenModel.tokens.map((t) => [t.name, t]));

  it('adopts :root custom properties as tokens under the author name', () => {
    expect([...byName.keys()].sort()).toEqual([
      '--card-gap',
      '--card-radius',
      '--card-shadow',
      '--font-body',
      '--primary-color',
    ]);
    expect(byName.get('--primary-color')?.displayName).toBe('Primary color');
  });

  it('classifies by value, using the name only to pick a length axis', () => {
    expect(byName.get('--primary-color')?.category).toBe('color');
    expect(byName.get('--primary-color')?.value).toBe('#7367f0');
    expect(byName.get('--card-radius')?.category).toBe('radius');
    expect(byName.get('--card-gap')?.category).toBe('spacing');
    expect(byName.get('--font-body')?.category).toBe('typography');
    expect(byName.get('--card-shadow')?.category).toBe('shadow');
    // Not themeable: a transition shorthand, and an alias to another property.
    expect(byName.has('--transition')).toBe(false);
    expect(byName.has('--alias')).toBe(false);
  });

  it('never emits a self-referential token', () => {
    const css = out.files['/theme.css'] as string;
    expect(css).not.toContain('--primary-color: var(--primary-color');
    expect(out.tokensCss).not.toMatch(/--([\w-]+):\s*var\(--\1/);
    // The definition MOVED into tokens.css — leaving it in place would beat
    // every re-theme, since the entry imports tokens.css first.
    expect(css).not.toContain('--primary-color: #7367F0');
    expect(out.tokensCss).toContain('--primary-color: #7367f0;');
  });

  it('gives bare var() references the hoisted literal as a fallback', () => {
    const css = out.files['/theme.css'] as string;
    expect(css).toContain('color: var(--primary-color, #7367f0)');
    expect(css).toContain('border-radius: var(--card-radius, 10px)');
  });

  it('leaves conditional theme blocks alone', () => {
    const css = out.files['/theme.css'] as string;
    expect(css).toContain('.dark');
    expect(css).toContain('--primary-color: #111827');
  });

  it('leaves a :root nested in an at-rule alone', () => {
    // Hoisting this would collapse a two-theme stylesheet into one theme.
    const media = tokenizeBundle({
      '/t.css': '@media (prefers-color-scheme: dark) {\n  :root { --bg: #000000; }\n}\n',
    });
    expect(media.tokenModel.tokens).toHaveLength(0);
    expect(media.files['/t.css']).toContain('--bg: #000000');
  });

  it('leaves an unparseable stylesheet exactly as it was', () => {
    const broken = '.a { color: #3b82f6;';
    const out2 = tokenizeBundle({ '/broken.css': broken });
    expect(out2.files['/broken.css']).toBe(broken);
    expect(out2.tokenModel.tokens).toHaveLength(0);
  });

  it('does not leave an empty :root behind, and drops nothing it did not adopt', () => {
    const css = out.files['/theme.css'] as string;
    expect(css).toContain('--transition: all 0.2s ease');
    // The alias survives as an alias — it just gains the hoisted literal, so it
    // still resolves when the bundle is copied without tokens.css.
    expect(css).toContain('--alias: var(--primary-color, #7367f0)');
    expect(css).toContain(':root {'); // still holds the two un-adopted properties
  });

  it('removes a :root rule it emptied', () => {
    const emptied = tokenizeBundle({ '/t.css': ':root {\n  --brand: #ff0000;\n}\n.a { color: red; }\n' });
    expect(emptied.files['/t.css']).not.toContain(':root');
    expect(emptied.tokensCss).toContain('--brand: #ff0000;');
  });

  it('never collides a generated name with an author-defined one', () => {
    const clash = tokenizeBundle({
      '/t.css': ':root {\n  --color-1: #ffffff;\n}\n.a { background: #3b82f6; }\n',
    });
    const names = clash.tokenModel.tokens.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('--color-1'); // the author's
    expect(names).toContain('--color-2'); // generated, stepping over the clash
    expect(clash.files['/t.css']).toContain('background: var(--color-2, #3b82f6)');
  });

  it('keeps a later :root override of the same name that carries a different value', () => {
    const dup = tokenizeBundle({
      '/a.css': ':root { --brand: #111111; }',
      '/b.css': ':root { --brand: #222222; }',
    });
    expect(dup.tokenModel.tokens.filter((t) => t.name === '--brand')).toHaveLength(1);
    expect(dup.tokenModel.tokens[0]?.value).toBe('#111111');
    // The conflicting definition stays put so rendering is unchanged.
    expect(dup.files['/b.css']).toContain('--brand: #222222');
  });
});

describe('tokenizeBundle — non-color custom properties (E-color)', () => {
  const MIXED = `:root {
  --brand-500: #7367F0;
  --font-weight-bold: 700;
  --z-index-modal: 1000;
}
.btn {
  color: var(--brand-500);
  font-weight: var(--font-weight-bold);
}
`;
  const out = tokenizeBundle({ '/theme.css': MIXED });
  const css = out.files['/theme.css'] as string;

  it('still adopts the property that IS written as a color', () => {
    expect(out.tokenModel.tokens.map((t) => t.name)).toEqual(['--brand-500']);
    expect(out.tokenModel.tokens[0]?.category).toBe('color');
    expect(out.tokensCss).toContain('--brand-500: #7367f0;');
    expect(css).toContain('color: var(--brand-500, #7367f0)');
  });

  it('leaves a font weight and a z-index untouched in the author stylesheet', () => {
    // `700` and `1000` parse as hex WITHOUT a '#', so both were classified as
    // colors: the declarations were removed from :root and re-emitted into
    // tokens.css as #770000 / #11000000 — silently changing what renders.
    expect(css).toContain('--font-weight-bold: 700');
    expect(css).toContain('--z-index-modal: 1000');
    // Not hoisted -> the reference keeps no literal fallback either.
    expect(css).toContain('font-weight: var(--font-weight-bold)');
    expect(css).not.toContain('font-weight: var(--font-weight-bold,');
  });

  it('emits no hex for either of them, in the stylesheet or in tokens.css', () => {
    expect(css).not.toContain('#770000');
    expect(css).not.toContain('#11000000');
    expect(out.tokensCss).not.toContain('--font-weight-bold');
    expect(out.tokensCss).not.toContain('--z-index-modal');
  });
});
