import { describe, it, expect } from 'vitest';
import type { Token } from '../src/api/types.js';
import {
  changedKitTokens,
  isKitRethemed,
  kitPresetScopeId,
  rethemeKitFiles,
  rethemeKitTokensCss,
} from '../src/features/kit/kit-retheme.js';

function token(id: string, name: string, value: string): Token {
  return {
    id,
    name,
    displayName: name,
    category: 'color',
    value,
    fallback: value,
    usages: [],
    source: 'extracted',
  };
}

/** A kit's shared token namespace: one `--color-1` used by every component. */
const TOKENS: Token[] = [
  token('t1', '--color-1', '#3b82f6'),
  token('t2', '--radius-1', '8px'),
];

/** What the engine wrote for these tokens with no overrides — the "original". */
const ORIGINAL_CSS = ':root {\n  --color-1: #3b82f6;\n  --radius-1: 8px;\n}\n';
const TOKENS_CSS_PATH = '/tokens.css';

describe('rethemeKitTokensCss (one override map → the whole kit’s tokens.css)', () => {
  it('reproduces the original :root block byte-for-byte when there are no overrides', () => {
    expect(rethemeKitTokensCss(TOKENS, {})).toBe(ORIGINAL_CSS);
  });

  it('re-themes by token id — the overridden line changes, the others stay', () => {
    const css = rethemeKitTokensCss(TOKENS, { t1: '#ff0000' });
    expect(css).toContain('--color-1: #ff0000;');
    expect(css).toContain('--radius-1: 8px;');
    expect(css).not.toContain('#3b82f6');
  });

  it('ignores override ids that name no token in the shared set', () => {
    expect(rethemeKitTokensCss(TOKENS, { 'not-a-token': '#000' })).toBe(ORIGINAL_CSS);
  });

  it('handles a kit with no extractable tokens', () => {
    expect(rethemeKitTokensCss([], {})).toBe(':root {\n}\n');
  });
});

describe('rethemeKitFiles (carry the re-themed sheet into the downloadable set)', () => {
  const files: Record<string, string> = {
    '/src/Button.tsx': 'export const Button = () => null;',
    [TOKENS_CSS_PATH]: ORIGINAL_CSS,
  };

  it('swaps only the tokens.css entry, leaving every other file untouched', () => {
    const out = rethemeKitFiles(files, TOKENS_CSS_PATH, TOKENS, { t1: '#ff0000' });
    expect(out['/src/Button.tsx']).toBe(files['/src/Button.tsx']);
    expect(out[TOKENS_CSS_PATH]).toContain('--color-1: #ff0000;');
  });

  it('empty overrides yield tokens.css identical to the original', () => {
    const out = rethemeKitFiles(files, TOKENS_CSS_PATH, TOKENS, {});
    expect(out[TOKENS_CSS_PATH]).toBe(ORIGINAL_CSS);
  });

  it('does not mutate the input map and returns a fresh object', () => {
    const out = rethemeKitFiles(files, TOKENS_CSS_PATH, TOKENS, { t1: '#ff0000' });
    expect(out).not.toBe(files);
    expect(files[TOKENS_CSS_PATH]).toBe(ORIGINAL_CSS);
  });
});

describe('changedKitTokens (honest "what did I change")', () => {
  it('reports a token whose override differs from its original value', () => {
    expect(changedKitTokens(TOKENS, { t1: '#ff0000' }).map((t) => t.id)).toEqual(['t1']);
  });

  it('excludes a no-op override equal to the token’s own value', () => {
    expect(changedKitTokens(TOKENS, { t1: '#3b82f6' })).toEqual([]);
  });

  it('excludes override ids that name no token in the set', () => {
    expect(changedKitTokens(TOKENS, { ghost: '#000' })).toEqual([]);
  });

  it('is empty with no overrides', () => {
    expect(changedKitTokens(TOKENS, {})).toEqual([]);
  });
});

describe('isKitRethemed (drives the Reset/Save enabled state)', () => {
  it('is true only when a real change exists', () => {
    expect(isKitRethemed(TOKENS, { t1: '#ff0000' })).toBe(true);
  });

  it('is false for empty and for no-op overrides', () => {
    expect(isKitRethemed(TOKENS, {})).toBe(false);
    expect(isKitRethemed(TOKENS, { t1: '#3b82f6' })).toBe(false);
  });
});

describe('kitPresetScopeId (presets belong to the exact basket they were saved on)', () => {
  it('is stable regardless of the id order in the basket', () => {
    expect(kitPresetScopeId(['b', 'a', 'c'])).toBe(kitPresetScopeId(['c', 'b', 'a']));
  });

  it('distinguishes different id-sets', () => {
    expect(kitPresetScopeId(['a', 'b'])).not.toBe(kitPresetScopeId(['a', 'b', 'c']));
  });
});
