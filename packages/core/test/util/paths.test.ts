import { describe, it, expect } from 'vitest';
import { isInside, shortHash, toBundlePath } from '../../src/util/paths.js';

describe('isInside', () => {
  it('treats a dir as inside itself', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true);
  });

  it('detects nested paths', () => {
    expect(isInside('/a/b', '/a/b/c/d.ts')).toBe(true);
  });

  it('rejects sibling and parent escapes', () => {
    expect(isInside('/a/b', '/a/c')).toBe(false);
    expect(isInside('/a/b', '/a')).toBe(false);
    expect(isInside('/a/b', '/a/b/../c')).toBe(false);
  });
});

describe('shortHash', () => {
  it('is deterministic and length-bounded', () => {
    expect(shortHash('/some/path')).toBe(shortHash('/some/path'));
    expect(shortHash('/some/path', 8)).toHaveLength(8);
  });

  it('differs for different inputs', () => {
    expect(shortHash('/a')).not.toBe(shortHash('/b'));
  });
});

describe('toBundlePath', () => {
  it('normalizes to a single leading slash', () => {
    expect(toBundlePath('Button.tsx')).toBe('/Button.tsx');
    expect(toBundlePath('./Button.tsx')).toBe('/Button.tsx');
    expect(toBundlePath('/Button.tsx')).toBe('/Button.tsx');
    expect(toBundlePath('icons/Chevron.tsx')).toBe('/icons/Chevron.tsx');
  });

  it('normalizes windows separators', () => {
    expect(toBundlePath('icons\\Chevron.tsx')).toBe('/icons/Chevron.tsx');
  });
});
