import { describe, expect, it } from 'vitest';
import {
  MUI_PALETTE_CONTROLS,
  hexToRgbChannel,
  isMuiPaletteId,
  muiPaletteVarOverrides,
  usesMui,
} from '../src/features/customize/mui-palette.js';

/**
 * MUI's theme is a JS object, so its colours used to be a read-only reference.
 * With the preview built in cssVariables mode, MUI emits `--mui-palette-*` vars
 * its components read — so overriding them re-themes live. These prove the pure
 * expansion from a colour pick to the exact vars the preview sets.
 */

describe('hexToRgbChannel', () => {
  it('converts a 6-digit hex to an "R G B" channel', () => {
    expect(hexToRgbChannel('#ff0000')).toBe('255 0 0');
    expect(hexToRgbChannel('#1976d2')).toBe('25 118 210');
  });
  it('expands a 3-digit hex', () => {
    expect(hexToRgbChannel('#0f8')).toBe('0 255 136');
  });
  it('returns null for a non-hex colour (rgb/hsl/named)', () => {
    expect(hexToRgbChannel('rgb(1,2,3)')).toBeNull();
    expect(hexToRgbChannel('red')).toBeNull();
    expect(hexToRgbChannel('')).toBeNull();
  });
});

describe('isMuiPaletteId', () => {
  it('recognises its own ids and not mined-token hashes', () => {
    expect(isMuiPaletteId('mui:primary')).toBe(true);
    expect(isMuiPaletteId('a1b2c3')).toBe(false);
  });
});

describe('usesMui', () => {
  it('is true for @mui/material or any @mui/* dep', () => {
    expect(usesMui({ '@mui/material': '^6' })).toBe(true);
    expect(usesMui({ '@mui/lab': '^6' })).toBe(true);
  });
  it('is false without MUI', () => {
    expect(usesMui({ react: '^19' })).toBe(false);
    expect(usesMui({})).toBe(false);
  });
});

describe('muiPaletteVarOverrides', () => {
  it('sets a role’s base var AND its channel var from a hex pick', () => {
    const out = muiPaletteVarOverrides({ 'mui:primary': '#ff0000' });
    expect(out['--mui-palette-primary-main']).toBe('#ff0000');
    expect(out['--mui-palette-primary-mainChannel']).toBe('255 0 0');
  });

  it('sets only the base var for a role with no channel (background)', () => {
    const out = muiPaletteVarOverrides({ 'mui:bg': '#101010' });
    expect(out['--mui-palette-background-default']).toBe('#101010');
    expect(Object.keys(out)).toEqual(['--mui-palette-background-default']);
  });

  it('skips the channel var when the colour is not a clean hex', () => {
    const out = muiPaletteVarOverrides({ 'mui:primary': 'rgb(1, 2, 3)' });
    expect(out['--mui-palette-primary-main']).toBe('rgb(1, 2, 3)');
    expect('--mui-palette-primary-mainChannel' in out).toBe(false);
  });

  it('ignores unset controls', () => {
    expect(muiPaletteVarOverrides({})).toEqual({});
    expect(muiPaletteVarOverrides({ 'mui:primary': '' })).toEqual({});
  });

  it('every control maps to a `--mui-palette-*` var', () => {
    for (const c of MUI_PALETTE_CONTROLS) {
      expect(c.cssVar.startsWith('--mui-palette-')).toBe(true);
      expect(isMuiPaletteId(c.id)).toBe(true);
    }
  });
});
