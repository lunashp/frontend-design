/**
 * Live re-theming of a MUI component's palette, via MUI's own CSS theme
 * variables.
 *
 * The preview is built with `cssVariables: true` (see the engine's provider
 * stub), so MUI emits `--mui-palette-*` custom properties on `:root` that its
 * components READ. Overriding those vars therefore re-themes the live preview —
 * the thing MUI's JS-object theme couldn't do, which is why theme colours used
 * to be a read-only reference. These controls expose the load-bearing palette
 * roles as colour pickers whose values flow through the existing token channel
 * (an inline `:root` custom-property set) into the preview.
 *
 * Pure: the control set + the override expansion are plain data, unit-tested
 * without a DOM.
 */

/** A palette control: a colour role and the MUI var(s) it drives. */
export interface MuiPaletteControl {
  /** Stable id, `mui:`-prefixed so it never collides with a mined token id. */
  readonly id: string;
  readonly label: string;
  /** The MUI variable this role's colour sets. */
  readonly cssVar: string;
  /**
   * The companion `*Channel` variable ("R G B"), which MUI uses for alpha
   * compositing (hover overlays, outlined borders). Set alongside `cssVar` so
   * those derived surfaces track the new colour too. Absent where MUI has none
   * (plain background vars).
   */
  readonly channelVar?: string;
}

/** The load-bearing palette: the six semantic roles plus surfaces and text. */
export const MUI_PALETTE_CONTROLS: readonly MuiPaletteControl[] = [
  { id: 'mui:primary', label: 'Primary', cssVar: '--mui-palette-primary-main', channelVar: '--mui-palette-primary-mainChannel' },
  { id: 'mui:secondary', label: 'Secondary', cssVar: '--mui-palette-secondary-main', channelVar: '--mui-palette-secondary-mainChannel' },
  { id: 'mui:success', label: 'Success', cssVar: '--mui-palette-success-main', channelVar: '--mui-palette-success-mainChannel' },
  { id: 'mui:error', label: 'Error', cssVar: '--mui-palette-error-main', channelVar: '--mui-palette-error-mainChannel' },
  { id: 'mui:warning', label: 'Warning', cssVar: '--mui-palette-warning-main', channelVar: '--mui-palette-warning-mainChannel' },
  { id: 'mui:info', label: 'Info', cssVar: '--mui-palette-info-main', channelVar: '--mui-palette-info-mainChannel' },
  { id: 'mui:bg', label: 'Background', cssVar: '--mui-palette-background-default' },
  { id: 'mui:paper', label: 'Surface', cssVar: '--mui-palette-background-paper' },
  { id: 'mui:text', label: 'Text', cssVar: '--mui-palette-text-primary', channelVar: '--mui-palette-text-primaryChannel' },
];

const MUI_PALETTE_ID = /^mui:/;

/** True for a control id this module owns (vs a mined-token id). */
export function isMuiPaletteId(id: string): boolean {
  return MUI_PALETTE_ID.test(id);
}

/** True when the component's deps include MUI — the section only makes sense
 *  then, and only then does the preview emit `--mui-*` vars to override. */
export function usesMui(externalDeps: Readonly<Record<string, string>>): boolean {
  return Object.keys(externalDeps).some((d) => d === '@mui/material' || d.startsWith('@mui/'));
}

/** `#rrggbb` / `#rgb` → `"r g b"` channel string, or null for a non-hex value
 *  (an `rgb()`/`hsl()` pick has no clean channel form, so its `*Channel` var is
 *  left untouched — the base colour still applies). */
export function hexToRgbChannel(hex: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1] as string;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/**
 * Expand the user's palette picks (control id → colour) into the concrete
 * `--mui-*` variable overrides the preview applies. Each set colour drives its
 * base var, and its `*Channel` var when the colour is a hex. Unset controls
 * contribute nothing.
 */
export function muiPaletteVarOverrides(
  picks: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const control of MUI_PALETTE_CONTROLS) {
    const value = picks[control.id];
    if (!value) continue;
    out[control.cssVar] = value;
    if (control.channelVar) {
      const channel = hexToRgbChannel(value);
      if (channel) out[control.channelVar] = channel;
    }
  }
  return out;
}
