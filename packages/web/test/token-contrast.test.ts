/**
 * The ink ladder has to be legible on the surfaces it actually sits on.
 *
 * This app SHIPS an accessibility auditor, and it was failing its own audit: an
 * axe run over the gallery and the inspector reported 21 serious `color-contrast`
 * nodes, every one of them `--text-faint` on a tinted surface (folder-chip counts,
 * the "Context load" label, the props group count). `--text-faint` measured 3.40:1
 * on `--bg` — the app's own ground — so it was below AA everywhere it could be used,
 * not just in an edge case.
 *
 * These tests pin the ladder to WCAG AA on every documented surface so the ink can
 * only be lightened again deliberately.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TOKENS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'styles', 'tokens.css'),
  'utf8',
);

/** Reads a `--token: #rrggbb;` declaration out of the `:root` block. */
function token(name: string): string {
  const m = TOKENS.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ${name} not found (or not a plain hex)`);
  return m[1] as string;
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(Number.parseInt(hex.slice(1, 3), 16));
  const g = channel(Number.parseInt(hex.slice(3, 5), 16));
  const b = channel(Number.parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-3'] as const;
const INKS = ['--text', '--text-dim', '--text-faint'] as const;

describe('ink ladder contrast', () => {
  for (const ink of INKS) {
    for (const surface of SURFACES) {
      it(`${ink} on ${surface} meets WCAG AA (4.5:1)`, () => {
        const ratio = contrast(token(ink), token(surface));
        expect(
          ratio,
          `${ink} ${token(ink)} on ${surface} ${token(surface)} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('keeps a visible hierarchy between the three inks', () => {
    const [strong, mid, faint] = INKS.map((t) => luminance(token(t))) as [number, number, number];
    expect(strong).toBeLessThan(mid);
    expect(mid).toBeLessThan(faint);
  });
});
