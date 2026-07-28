/**
 * Colour values for the Customize controls, alpha included.
 *
 * `<input type="color">` cannot represent alpha at all: it accepts and returns
 * only `#rrggbb`. The engine, meanwhile, normalizes an alpha-bearing colour to
 * `#rrggbbaa` (see core's `normalizeColor`), so a token captured as `#00000080`
 * was handed to the swatch, rejected as malformed, and rendered as opaque black
 * — the token read as solid, and the next drag of the swatch wrote back an
 * opaque colour, destroying the alpha for good.
 *
 * So the swatch is fed the opaque half only, the authoritative value keeps its
 * alpha, and alpha is edited by its own control. `withPickedColor` is the piece
 * that matters: a swatch drag re-attaches the alpha that was already there.
 */

/** A colour the swatch can show: its opaque half, plus alpha as a 0–255 byte. */
export interface ColorValue {
  /** Lowercase `#rrggbb` — the only shape `<input type="color">` accepts. */
  readonly hex6: string;
  /** 0–255. A byte, not a float, so a hex8 value round-trips exactly. */
  readonly alpha: number;
}

export const OPAQUE = 255;

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i;

function byte(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
}

/** `#abc` and `#abcd` expand each digit; `#rrggbb`/`#rrggbbaa` pass through. */
function parseHex(trimmed: string): ColorValue | null {
  if (!HEX.test(trimmed)) return null;
  const body = trimmed.slice(1).toLowerCase();
  const expanded = body.length <= 4 ? [...body].map((c) => c + c).join('') : body;
  return {
    hex6: `#${expanded.slice(0, 6)}`,
    alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) : OPAQUE,
  };
}

/** `50%` → 127.5 of `scale`; a bare number is taken as-is. */
function channel(part: string, scale: number): number | null {
  const pct = part.endsWith('%');
  const n = Number.parseFloat(pct ? part.slice(0, -1) : part);
  if (!Number.isFinite(n)) return null;
  return pct ? (n / 100) * scale : n;
}

/** Both `rgb(0, 0, 0)` and the space/slash form `rgb(0 0 0 / 50%)`. */
function parseRgbFunction(trimmed: string): ColorValue | null {
  const match = RGB_FUNCTION.exec(trimmed);
  if (!match) return null;
  const parts = (match[1] ?? '').split(/[\s,/]+/).filter((p) => p.length > 0);
  if (parts.length < 3 || parts.length > 4) return null;
  const rgb: string[] = [];
  for (const part of parts.slice(0, 3)) {
    const c = channel(part, 255);
    if (c === null) return null;
    rgb.push(byte(c));
  }
  const alphaPart = parts[3];
  const a = alphaPart === undefined ? 1 : channel(alphaPart, 1);
  if (a === null) return null;
  return {
    hex6: `#${rgb.join('')}`,
    alpha: Math.max(0, Math.min(OPAQUE, Math.round(a * OPAQUE))),
  };
}

/**
 * Split a colour into what the swatch can show and the alpha it cannot.
 * Null for anything else (`var(--brand)`, `oklch(…)`, an empty field) — those
 * stay editable as text and are never rewritten behind the user's back.
 *
 * `transparent` is included because the engine emits it verbatim rather than as
 * `#00000000`; read as unparseable, the first swatch drag would have turned an
 * intentionally invisible surface fully opaque. `currentcolor` is not: it has no
 * literal to split, so there is nothing honest to show.
 */
export function parseColorValue(value: string): ColorValue | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.toLowerCase() === 'transparent') return { hex6: '#000000', alpha: 0 };
  return parseHex(trimmed) ?? parseRgbFunction(trimmed);
}

/**
 * Hex6 while opaque, hex8 once alpha drops — the same rule the engine's
 * `normalizeColor` follows, so an edited token still matches its captured form.
 */
export function formatColorValue(color: ColorValue): string {
  return color.alpha >= OPAQUE ? color.hex6 : `${color.hex6}${byte(color.alpha)}`;
}

/** What to hand `<input type="color">`; `fallback` when the value isn't a colour. */
export function swatchValue(value: string, fallback: string): string {
  return parseColorValue(value)?.hex6 ?? fallback;
}

/** Apply a swatch pick, carrying over the alpha the previous value already had. */
export function withPickedColor(previous: string, picked: string): string {
  const before = parseColorValue(previous);
  const after = parseColorValue(picked);
  if (after === null) return picked;
  return formatColorValue({ hex6: after.hex6, alpha: before?.alpha ?? OPAQUE });
}

/** Apply an alpha edit (0–100) to a colour, leaving a non-colour untouched. */
export function withAlphaPercent(previous: string, percent: number): string {
  const before = parseColorValue(previous);
  if (before === null) return previous;
  const clamped = Math.max(0, Math.min(100, percent));
  return formatColorValue({ hex6: before.hex6, alpha: Math.round((clamped / 100) * OPAQUE) });
}

/** Alpha as a whole percentage, for the control's readout. */
export function alphaPercent(alpha: number): number {
  return Math.round((alpha / OPAQUE) * 100);
}
