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
    expect(css).toContain('padding: 10px 16px'); // untouched
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
