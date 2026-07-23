import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { mineThemeTokens } from '../../src/theme/theme-extractor.js';
import type { ThemeRef } from '../../src/types/project.js';

const THEME_FILE = path.resolve(import.meta.dirname, '../fixtures/mui-theme/src/config/theme.ts');
const PANEL_FILE = path.resolve(import.meta.dirname, '../fixtures/mui-theme/src/Panel.tsx');

const APP_THEME: ThemeRef = { file: THEME_FILE, exportName: 'appTheme' };

describe('mineThemeTokens — static, literal-only theme mining', () => {
  it('mines literal palette colors as derived tokens with dotted human names', () => {
    const result = mineThemeTokens(APP_THEME);
    expect(result).not.toBeNull();
    const tokens = result!.tokens;

    const primary = tokens.find((t) => t.displayName === 'palette.primary.main');
    expect(primary).toBeDefined();
    expect(primary!.source).toBe('derived');
    expect(primary!.category).toBe('color');
    // Normalized hex (culori lower-cases + expands).
    expect(primary!.value).toBe('#1976d2');
    // Usage points back at the theme file so the UI can link to it.
    expect(primary!.usages[0]?.file).toBe(THEME_FILE);
    expect(primary!.usages[0]?.line).toBeGreaterThan(0);

    // Every mined token is derived — none masquerade as extracted CSS tokens.
    expect(tokens.every((t) => t.source === 'derived')).toBe(true);
  });

  it('mines typography sizes, borderRadius and spacing as categorized tokens', () => {
    const result = mineThemeTokens(APP_THEME);
    const byName = new Map(result!.tokens.map((t) => [t.displayName, t]));

    expect(byName.get('shape.borderRadius')?.category).toBe('radius');
    expect(byName.get('shape.borderRadius')?.value).toBe('12');
    expect(byName.get('spacing')?.category).toBe('spacing');
    expect(byName.get('spacing')?.value).toBe('8');
    expect(byName.get('typography.h1.fontSize')?.category).toBe('typography');
    expect(byName.get('typography.h1.fontSize')?.value).toBe('2.5rem');
    expect(byName.get('typography.fontFamily')?.category).toBe('typography');
  });

  it('counts a referenced-constant value as unresolved and never emits it', () => {
    const result = mineThemeTokens(APP_THEME);
    // palette.primary.dark = brandNavy (an identifier) — must NOT become a token.
    expect(result!.tokens.some((t) => t.displayName === 'palette.primary.dark')).toBe(false);
    expect(result!.disclosure.unresolvedPaths).toContain('palette.primary.dark');
    expect(result!.disclosure.unresolved).toBeGreaterThanOrEqual(1);
  });

  it('counts a spread of a non-literal as unresolved', () => {
    const result = mineThemeTokens(APP_THEME);
    expect(result!.disclosure.unresolvedPaths.some((p) => p.includes('spread'))).toBe(true);
  });

  it('mines nested colorSchemes into a themes preset map with distinct values', () => {
    const result = mineThemeTokens(APP_THEME);
    expect(result!.themes).toBeDefined();
    const themes = result!.themes!;
    expect(Object.keys(themes).sort()).toEqual(['dark', 'light']);

    const primaryId = result!.tokens.find((t) => t.displayName === 'palette.primary.main')!.id;
    expect(themes.light?.[primaryId]).toBe('#1976d2');
    expect(themes.dark?.[primaryId]).toBe('#90caf9');
    // The two presets genuinely differ — not a copy of one scheme.
    expect(themes.light?.[primaryId]).not.toBe(themes.dark?.[primaryId]);
  });

  it('reports the disclosure: theme file, export name, resolved/unresolved counts', () => {
    const result = mineThemeTokens(APP_THEME);
    const d = result!.disclosure;
    expect(d.file).toBe(THEME_FILE);
    expect(d.exportName).toBe('appTheme');
    // The realistic fixture: 15 resolved literals, 2 unresolved (brandNavy + spread).
    expect(d.resolved).toBe(15);
    expect(d.unresolved).toBe(2);
    expect(d.resolved).toBe(result!.tokens.length);
  });

  it('returns null when the export is not a createTheme call', () => {
    expect(mineThemeTokens({ file: PANEL_FILE, exportName: 'Panel' })).toBeNull();
  });

  it('returns null when the file cannot be read', () => {
    expect(mineThemeTokens({ file: '/no/such/theme.ts', exportName: 'x' })).toBeNull();
  });
});
