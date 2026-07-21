/**
 * Universal design overrides — customize a component's look even when it
 * exposes no design tokens. `emitDesignCss` produces the `#root > *` `!important`
 * form used by a live preview (the web app injects it into the sandbox iframe);
 * `emitDesignRule` produces a copyable, `!important`-free `.Name { … }` rule for
 * porting. Pure string logic — no framework or DOM dependency — so it is shared
 * by every consumer (web app, MCP).
 *
 * The web app keeps its own mirror of this module for the browser bundle (which
 * never imports @ce/core); keep the two in sync.
 */

export type DesignControlKind = 'range' | 'color' | 'select' | 'text';

export interface DesignOption {
  readonly label: string;
  readonly value: string;
}

export interface DesignField {
  readonly id: string;
  readonly label: string;
  readonly control: DesignControlKind;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly default?: string;
  readonly placeholder?: string;
  readonly options?: readonly DesignOption[];
}

export interface DesignGroup {
  readonly label: string;
  readonly fields: readonly DesignField[];
}

const WEIGHT_OPTIONS: readonly DesignOption[] = [
  { label: 'Default', value: '' },
  { label: 'Light 300', value: '300' },
  { label: 'Regular 400', value: '400' },
  { label: 'Medium 500', value: '500' },
  { label: 'Semibold 600', value: '600' },
  { label: 'Bold 700', value: '700' },
];

const FONT_OPTIONS: readonly DesignOption[] = [
  { label: 'Default', value: '' },
  { label: 'System sans', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, "SF Mono", Menlo, monospace' },
  { label: 'Rounded', value: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif' },
];

const SHADOW_OPTIONS: readonly DesignOption[] = [
  { label: 'Default', value: '' },
  { label: 'None', value: 'none' },
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' },
  { label: 'X-Large', value: 'xl' },
];

const SHADOW_PRESETS: Record<string, string> = {
  none: 'none',
  sm: '0 1px 2px rgba(15, 23, 42, 0.12)',
  md: '0 4px 12px rgba(15, 23, 42, 0.15)',
  lg: '0 10px 30px rgba(15, 23, 42, 0.18)',
  xl: '0 20px 50px rgba(15, 23, 42, 0.22)',
};

export const DESIGN_GROUPS: readonly DesignGroup[] = [
  {
    label: 'Size',
    fields: [
      { id: 'scale', label: 'Scale', control: 'range', min: 50, max: 200, step: 1, unit: '%', default: '100' },
      { id: 'width', label: 'Width', control: 'text', placeholder: 'auto · 240px · 100%' },
      { id: 'padding', label: 'Padding', control: 'range', min: 0, max: 64, step: 1, unit: 'px' },
    ],
  },
  {
    label: 'Color',
    fields: [
      { id: 'color', label: 'Text', control: 'color' },
      { id: 'background', label: 'Background', control: 'color' },
    ],
  },
  {
    label: 'Typography',
    fields: [
      { id: 'fontSize', label: 'Font size', control: 'range', min: 10, max: 40, step: 1, unit: 'px' },
      { id: 'fontWeight', label: 'Weight', control: 'select', options: WEIGHT_OPTIONS },
      { id: 'fontFamily', label: 'Font', control: 'select', options: FONT_OPTIONS },
    ],
  },
  {
    label: 'Border & shape',
    fields: [
      { id: 'radius', label: 'Radius', control: 'range', min: 0, max: 48, step: 1, unit: 'px' },
      { id: 'borderWidth', label: 'Border width', control: 'range', min: 0, max: 10, step: 1, unit: 'px' },
      { id: 'borderColor', label: 'Border color', control: 'color' },
    ],
  },
  {
    label: 'Effects',
    fields: [
      { id: 'shadow', label: 'Shadow', control: 'select', options: SHADOW_OPTIONS },
      { id: 'opacity', label: 'Opacity', control: 'range', min: 0, max: 100, step: 1, unit: '%', default: '100' },
    ],
  },
];

const IMPORTANT = ' !important';

/** Build the list of CSS declarations for the set overrides (each with !important). */
export function emitDesignDeclarations(overrides: Readonly<Record<string, string>> = {}): string[] {
  const o = overrides;
  const has = (k: string) => o[k] !== undefined && o[k] !== '';
  const n = (k: string) => Number(o[k]);
  const d: string[] = [];

  if (has('scale') && n('scale') !== 100) {
    d.push(`transform: scale(${n('scale') / 100})${IMPORTANT}`);
    d.push(`transform-origin: top left${IMPORTANT}`);
  }
  if (has('width')) d.push(`width: ${o.width}${IMPORTANT}`);
  if (has('padding')) d.push(`padding: ${n('padding')}px${IMPORTANT}`);
  if (has('color')) d.push(`color: ${o.color}${IMPORTANT}`);
  if (has('background')) d.push(`background: ${o.background}${IMPORTANT}`);
  if (has('fontSize')) d.push(`font-size: ${n('fontSize')}px${IMPORTANT}`);
  if (has('fontWeight')) d.push(`font-weight: ${o.fontWeight}${IMPORTANT}`);
  if (has('fontFamily')) d.push(`font-family: ${o.fontFamily}${IMPORTANT}`);
  if (has('radius')) d.push(`border-radius: ${n('radius')}px${IMPORTANT}`);

  const bw = has('borderWidth');
  const bc = has('borderColor');
  if (bw && n('borderWidth') === 0) {
    d.push(`border: none${IMPORTANT}`);
  } else if (bw || bc) {
    d.push(`border-style: solid${IMPORTANT}`);
    d.push(`border-width: ${bw ? n('borderWidth') : 1}px${IMPORTANT}`);
    d.push(`border-color: ${bc ? o.borderColor : 'currentColor'}${IMPORTANT}`);
  }

  if (has('shadow')) {
    const sv = o.shadow ?? '';
    d.push(`box-shadow: ${SHADOW_PRESETS[sv] ?? sv}${IMPORTANT}`);
  }
  if (has('opacity') && n('opacity') !== 100) d.push(`opacity: ${n('opacity') / 100}${IMPORTANT}`);

  return d;
}

/** Inline declaration string for injecting into `#root > * { … }` in a preview. */
export function emitDesignCss(overrides: Readonly<Record<string, string>> = {}): string {
  const d = emitDesignDeclarations(overrides);
  return d.length ? `${d.join('; ')};` : '';
}

/** A copyable, human-readable CSS rule (no !important) targeting the component. */
export function emitDesignRule(name: string, overrides: Readonly<Record<string, string>> = {}): string {
  const d = emitDesignDeclarations(overrides);
  if (d.length === 0) return '';
  const body = d.map((decl) => `  ${decl.replace(IMPORTANT, '')};`).join('\n');
  const selector = /^[A-Za-z][\w-]*$/.test(name) ? `.${name}` : '.component';
  return `/* Design overrides for ${name} — apply to the component's root element */\n${selector} {\n${body}\n}\n`;
}
