import { describe, it, expect } from 'vitest';
import { findPropsLiteral, mergeIntoPropsLiteral } from '../../src/customize/props-literal.js';

describe('findPropsLiteral', () => {
  it('matches balanced braces, not the first closing one', () => {
    const entry = 'const props = {\n  "a": {"b": 1}\n};\nconst root = 1;\n';
    const match = findPropsLiteral(entry);
    expect(match?.literal).toBe('{\n  "a": {"b": 1}\n}');
    expect(entry.slice(match?.end)).toBe(';\nconst root = 1;\n');
  });

  it('ignores braces and brackets inside string values', () => {
    const entry = 'const props = { "a": "}{ ]", "b": 1 };';
    expect(findPropsLiteral(entry)?.literal).toBe('{ "a": "}{ ]", "b": 1 }');
  });

  it('tolerates an escaped quote inside a string value', () => {
    const entry = 'const props = { "a": "say \\" }", "b": 1 };';
    expect(findPropsLiteral(entry)?.literal).toBe('{ "a": "say \\" }", "b": 1 }');
  });

  it('returns null with no declaration, and null when the braces never balance', () => {
    expect(findPropsLiteral('const other = {};')).toBeNull();
    expect(findPropsLiteral('const props = { "a": 1')).toBeNull();
  });
});

describe('mergeIntoPropsLiteral', () => {
  it('preserves bare identifiers (function stubs) through the round trip', () => {
    const out = mergeIntoPropsLiteral('{ "label": "a", "onSelect": __fnStub }', { label: 'b' });
    expect(out).toContain('"label": "b"');
    expect(out).toContain('"onSelect": __fnStub');
  });

  it('preserves member expressions and single-quoted strings verbatim', () => {
    const out = mergeIntoPropsLiteral("{ \"icon\": Icons.check, \"tip\": 'hi', \"n\": 1 }", { n: 2 });
    expect(out).toContain('"icon": Icons.check');
    expect(out).toContain('"tip": \'hi\'');
    expect(out).toContain('"n": 2');
  });

  it('keeps true / false / null as JSON, not as placeholders', () => {
    const out = mergeIntoPropsLiteral('{ "a": true, "b": false, "c": null }', { d: 1 });
    expect(out).toContain('"a": true');
    expect(out).toContain('"b": false');
    expect(out).toContain('"c": null');
  });

  it('overrides an unquoted key rather than duplicating it', () => {
    const out = mergeIntoPropsLiteral('{ label: "a" }', { label: 'b' });
    expect(out).toBe('{\n  "label": "b"\n}');
  });

  it('does not unmask a placeholder-looking value supplied by the caller', () => {
    const out = mergeIntoPropsLiteral('{ "fn": __ceRaw0__ }', { text: '__ceRaw0__' });
    expect(out).toContain('"fn": __ceRaw0__');
    expect(out).toContain('"text": "__ceRaw0__"');
  });

  it('returns null for a literal it cannot understand', () => {
    expect(mergeIntoPropsLiteral('{ "when": new Date() }', { a: 1 })).toBeNull();
    expect(mergeIntoPropsLiteral('[1, 2]', { a: 1 })).toBeNull();
  });
});
