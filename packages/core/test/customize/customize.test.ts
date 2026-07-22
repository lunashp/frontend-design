import { describe, it, expect } from 'vitest';
import {
  patchEntryProps,
  injectTokenOverrides,
  customizeSpec,
  customizeArtifact,
} from '../../src/customize/customize-artifact.js';
import {
  DESIGN_FIELDS,
  DESIGN_GROUPS,
  designStateKey,
  emitDesignBlocks,
  emitDesignCss,
  emitDesignDeclarations,
  emitDesignRule,
  emitDesignStyleSheet,
  isDesignKey,
  parseDesignKey,
  splitDesignOverrides,
} from '../../src/customize/design-overrides.js';
import type { ComponentArtifact } from '../../src/types/artifact.js';
import type { Token } from '../../src/types/token-model.js';

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

const TOKENS: Token[] = [token('t1', '--color-1', '#3b82f6'), token('t2', '--radius-1', '8px')];

function artifactWith(files: Record<string, string>, name = 'Widget'): ComponentArtifact {
  return {
    descriptor: { id: 'abc123', name },
    tokenModel: { tokens: TOKENS },
    sandpack: {
      files,
      entryPath: '/index.tsx',
      template: 'react-ts',
      dependencies: {},
      renderability: 'full',
      notes: [],
    },
  } as unknown as ComponentArtifact;
}

describe('patchEntryProps', () => {
  const entry = 'const props = {\n  "variant": "primary",\n  "size": "sm"\n};\n';
  it('merges prop values into the props literal', () => {
    const out = patchEntryProps(entry, { variant: 'secondary' });
    expect(out.entry).toContain('"variant": "secondary"');
    expect(out.entry).toContain('"size": "sm"');
    expect(out.warnings).toEqual([]);
  });
  it('is a no-op with no prop values', () => {
    expect(patchEntryProps(entry, {})).toEqual({ entry, warnings: [] });
  });

  // Regression (C2): build-entry emits `"onSelect": __fnStub` for required
  // function props. That is not JSON, so a plain JSON.parse threw and every
  // other sample prop was dropped from the preview the moment a prop was edited.
  it('keeps every sample prop when the literal holds a function stub', () => {
    const withStub =
      'const props = {\n  "label": "Save",\n  "children": "Save",\n  "onSelect": __fnStub\n};\n';
    const out = patchEntryProps(withStub, { label: 'Cancel' });
    expect(out.warnings).toEqual([]);
    expect(out.entry).toContain('"label": "Cancel"');
    expect(out.entry).toContain('"children": "Save"');
    expect(out.entry).toContain('"onSelect": __fnStub');
    expect(out.entry).not.toContain('"__fnStub"');
  });

  // The old lazy `\{[\s\S]*?\};` regex ended the literal at the first `};` it
  // saw — including one inside a string value — and truncated everything after.
  it('keeps nested props whose values contain a brace-semicolon', () => {
    const nested =
      'const props = {\n  "user": {"name": "Ada", "tags": ["x"]},\n  "code": "if (x) {};",\n  "count": 2\n};\nconst root = createRoot(el);\n';
    const out = patchEntryProps(nested, { count: 5 });
    expect(out.entry).toContain('"name": "Ada"');
    expect(out.entry).toContain('"if (x) {};"');
    expect(out.entry).toContain('"count": 5');
    expect(out.entry).toContain('const root = createRoot(el);');
    expect(out.warnings).toEqual([]);
  });

  it('falls back to a runtime spread — and reports it — when the literal is unparseable', () => {
    const weird = 'const props = {\n  "when": new Date()\n};\n';
    const out = patchEntryProps(weird, { label: 'x' });
    expect(out.entry).toContain('...(');
    expect(out.entry).toContain('new Date()');
    expect(out.entry).toContain('"label":"x"');
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/could not parse/i);
  });

  it('reports, rather than silently skipping, an entry with no props literal', () => {
    const out = patchEntryProps('const other = {};\n', { label: 'x' });
    expect(out.entry).toBe('const other = {};\n');
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/no balanced/i);
  });
});

describe('injectTokenOverrides', () => {
  const entry = 'const props = {};\nconst root = createRoot(el);\nroot.render(<C {...props} />);\n';
  it('injects setProperty calls for overridden tokens before mount', () => {
    const out = injectTokenOverrides(entry, TOKENS, { t1: '#e11d48' });
    expect(out).toContain('setProperty');
    expect(out).toContain('--color-1');
    expect(out).toContain('#e11d48');
    expect(out.indexOf('setProperty')).toBeLessThan(out.indexOf('createRoot'));
  });
  it('is a no-op with no overrides', () => {
    expect(injectTokenOverrides(entry, TOKENS, {})).toBe(entry);
  });
  it('ignores override ids that match no token', () => {
    expect(injectTokenOverrides(entry, TOKENS, { nope: '#000' })).toBe(entry);
  });
});

describe('customizeSpec', () => {
  const artifact = artifactWith({
    '/index.tsx': 'const props = {};\nconst root = createRoot(el);',
    '/tokens.css': ':root {\n  --color-1: #3b82f6;\n}\n',
  });

  it('rewrites tokens.css and entry from customization state', () => {
    const spec = customizeSpec(artifact, {
      tokenOverrides: { t1: '#e11d48' },
      propValues: {},
    });
    expect(spec.files['/tokens.css']).toContain('--color-1: #e11d48;');
    expect(spec.files['/index.tsx']).toContain('setProperty');
    expect(spec.files['/index.tsx']).toContain('#e11d48');
  });
});

describe('emitDesignCss (universal design overrides)', () => {
  it('is empty when nothing is set', () => {
    expect(emitDesignCss({})).toBe('');
  });
  it('maps colour and spacing to !important declarations', () => {
    const css = emitDesignCss({ color: '#fff', background: '#000', padding: '12' });
    expect(css).toContain('color: #fff !important;');
    expect(css).toContain('background: #000 !important;');
    expect(css).toContain('padding: 12px !important;');
  });
  it('turns scale into a transform, and skips a no-op scale of 100', () => {
    expect(emitDesignCss({ scale: '120' })).toContain('transform: scale(1.2) !important;');
    expect(emitDesignCss({ scale: '100' })).toBe('');
  });
  it('composes a border from width + colour, and border:none at width 0', () => {
    const css = emitDesignCss({ borderWidth: '2', borderColor: '#f00' });
    expect(css).toContain('border-style: solid !important;');
    expect(css).toContain('border-width: 2px !important;');
    expect(css).toContain('border-color: #f00 !important;');
    expect(emitDesignCss({ borderWidth: '0' })).toContain('border: none !important;');
  });
  it('composes a border from colour alone (default width)', () => {
    const css = emitDesignCss({ borderColor: '#0f0' });
    expect(css).toContain('border-width: 1px !important;');
    expect(css).toContain('border-color: #0f0 !important;');
  });
  it('resolves shadow presets, raw shadows, weight, family, width and opacity', () => {
    expect(emitDesignCss({ shadow: 'md' })).toContain('box-shadow: 0 4px 12px');
    expect(emitDesignCss({ shadow: '0 0 1px red' })).toContain('box-shadow: 0 0 1px red !important;');
    expect(emitDesignCss({ fontSize: '18', fontWeight: '600' })).toContain('font-weight: 600 !important;');
    expect(emitDesignCss({ fontFamily: 'Georgia, serif' })).toContain('font-family: Georgia, serif !important;');
    expect(emitDesignCss({ width: '240px' })).toContain('width: 240px !important;');
    expect(emitDesignCss({ opacity: '50' })).toContain('opacity: 0.5 !important;');
    expect(emitDesignCss({ opacity: '100' })).toBe('');
  });
});

describe('interactive states (hover / focus / active)', () => {
  it('splits a flat map into resting and per-state buckets', () => {
    const { base, states } = splitDesignOverrides({
      color: '#111',
      'hover:color': '#222',
      'active:scale': '98',
    });
    expect(base).toEqual({ color: '#111' });
    expect(states.hover).toEqual({ color: '#222' });
    expect(states.active).toEqual({ scale: '98' });
    expect(states.focus).toBeUndefined();
  });

  it('treats an unknown prefix as part of a (bare, unknown) field id', () => {
    expect(parseDesignKey('nope:color')).toEqual({ state: null, field: 'nope:color' });
    expect(parseDesignKey('hover:color')).toEqual({ state: 'hover', field: 'color' });
    expect(designStateKey('focus', 'borderColor')).toBe('focus:borderColor');
    expect(designStateKey(null, 'color')).toBe('color');
  });

  it('accepts state-prefixed keys as real design fields', () => {
    expect(isDesignKey('background')).toBe(true);
    expect(isDesignKey('hover:background')).toBe(true);
    expect(isDesignKey('borderRadius')).toBe(false);
    expect(isDesignKey('hover:borderRadius')).toBe(false);
  });

  it('emits one preview rule per state, with :focus-visible for focus', () => {
    const sheet = emitDesignStyleSheet({
      background: '#fff',
      'hover:background': '#eee',
      'focus:borderColor': '#00f',
      'active:scale': '98',
    });
    expect(sheet).toContain('#root > * { background: #fff !important; }');
    expect(sheet).toContain('#root > *:hover { background: #eee !important; }');
    expect(sheet).toContain('#root > *:focus-visible {');
    expect(sheet).toContain('border-color: #00f !important');
    expect(sheet).toContain('#root > *:active { transform: scale(0.98) !important');
  });

  it('emits nothing when no override is set, and honours a custom selector', () => {
    expect(emitDesignStyleSheet({})).toBe('');
    expect(emitDesignStyleSheet({ color: '#111' }, '.Card')).toBe('.Card { color: #111 !important; }');
  });

  it('keeps a plain unprefixed map working exactly as before', () => {
    expect(emitDesignCss({ color: '#111' })).toBe('color: #111 !important;');
    expect(emitDesignBlocks({ color: '#111' })).toEqual([
      { state: null, selectorSuffix: '', declarations: ['color: #111 !important'] },
    ]);
  });

  it('exposes every DESIGN_GROUPS field id, and only those', () => {
    expect(DESIGN_FIELDS).toEqual(DESIGN_GROUPS.flatMap((g) => g.fields.map((f) => f.id)));
    expect(DESIGN_FIELDS).toHaveLength(13);
    expect(DESIGN_FIELDS).toContain('borderWidth');
    expect(DESIGN_FIELDS).not.toContain('borderRadius');
  });
});

/**
 * `scale` and `opacity` carry an identity value (100) that must not emit — an
 * unconditional `transform: scale(1) !important` would wipe out whatever
 * transform the component sets for itself. That elision used to be ABSOLUTE, so
 * `hover:scale = 100` was inexpressible: "enlarged at rest, normal on hover"
 * could not be authored at all, and the Hover tab's Scale slider silently did
 * nothing at exactly the value it is rendered at. Measured against the RESTING
 * value instead, a state declaration is dropped only when it really is no change.
 */
describe('no-op elision is relative to the resting state', () => {
  it('emits a state scale that returns the component to its natural size', () => {
    const sheet = emitDesignStyleSheet({ scale: '120', 'hover:scale': '100' });
    expect(sheet).toContain('#root > * { transform: scale(1.2) !important');
    expect(sheet).toContain('#root > *:hover { transform: scale(1) !important');
  });

  it('emits a state opacity that returns the component to fully opaque', () => {
    const sheet = emitDesignStyleSheet({ opacity: '50', 'focus:opacity': '100' });
    expect(sheet).toContain('#root > *:focus-visible { opacity: 1 !important');
  });

  it('drops a state value equal to the resting one — same as rest is no change', () => {
    expect(emitDesignStyleSheet({ scale: '120', 'hover:scale': '120' })).toBe(
      '#root > * { transform: scale(1.2) !important; transform-origin: top left !important; }',
    );
    expect(emitDesignStyleSheet({ opacity: '50', 'active:opacity': '50' })).toBe(
      '#root > * { opacity: 0.5 !important; }',
    );
  });

  it('drops a no-op state value for every field, not only the percentages', () => {
    // `scale` and `opacity` have an identity value the emitter can recognise on
    // its own. The other eleven fields do not, so a `:hover` rule repeating the
    // resting declaration verbatim is only detectable by comparing the emitted
    // blocks — and a dead rule still lights the "has overrides" dot.
    expect(emitDesignStyleSheet({ radius: '8', 'hover:radius': '8' })).toBe(
      '#root > * { border-radius: 8px !important; }',
    );
    expect(emitDesignStyleSheet({ background: '#eee', 'focus:background': '#eee' })).toBe(
      '#root > * { background: #eee !important; }',
    );
    // …while a state value that genuinely differs still paints.
    expect(emitDesignStyleSheet({ radius: '8', 'hover:radius': '12' })).toBe(
      '#root > * { border-radius: 8px !important; }\n' +
        '#root > *:hover { border-radius: 12px !important; }',
    );
  });

  it('falls back to the identity when the resting value is unset or blank', () => {
    expect(emitDesignStyleSheet({ 'hover:scale': '100' })).toBe('');
    expect(emitDesignStyleSheet({ scale: '', 'active:opacity': '100' })).toBe('');
  });

  it('takes the resting map directly, so the emitter stays a pure function', () => {
    expect(emitDesignDeclarations({ scale: '100' }, { scale: '120' })).toEqual([
      'transform: scale(1) !important',
      'transform-origin: top left !important',
    ]);
    expect(emitDesignDeclarations({ scale: '100' })).toEqual([]);
  });
});

describe('emitDesignRule (copyable CSS)', () => {
  it('emits a named rule without !important', () => {
    const rule = emitDesignRule('MyButton', { color: '#111', radius: '8' });
    expect(rule).toContain('.MyButton {');
    expect(rule).toContain('color: #111;');
    expect(rule).toContain('border-radius: 8px;');
    expect(rule).not.toContain('!important');
  });
  it('emits a copyable rule per interactive state', () => {
    const rule = emitDesignRule('MyButton', { color: '#111', 'hover:color': '#222' });
    expect(rule).toContain('.MyButton {\n  color: #111;\n}');
    expect(rule).toContain('.MyButton:hover {\n  color: #222;\n}');
    expect(rule).not.toContain('!important');
  });
  it('emits only the state rule when nothing rests', () => {
    const rule = emitDesignRule('MyButton', { 'focus:borderColor': '#00f' });
    expect(rule).toContain('.MyButton:focus-visible {');
    expect(rule).not.toContain('.MyButton {');
  });
  it('falls back to .component for a non-identifier name', () => {
    expect(emitDesignRule('123 Bad', { color: '#111' })).toContain('.component {');
  });
  it('is empty when nothing is set', () => {
    expect(emitDesignRule('X', {})).toBe('');
  });
});

describe('customizeArtifact', () => {
  const artifact = artifactWith(
    {
      '/index.tsx': 'const props = {\n  "variant": "primary"\n};\nconst root = createRoot(el);',
      '/tokens.css': ':root {\n  --color-1: #3b82f6;\n  --radius-1: 8px;\n}\n',
    },
    'MyButton',
  );

  it('applies token overrides by id and re-themes tokens.css', () => {
    const out = customizeArtifact(artifact, {
      tokenOverrides: { t1: '#e11d48' },
      propValues: {},
    });
    expect(out.tokensCss).toContain('--color-1: #e11d48;');
    expect(out.tokensCss).toContain('--radius-1: 8px;');
    expect(out.appliedTokenOverrides).toEqual({ t1: '#e11d48' });
    expect(out.unknownTokenIds).toEqual([]);
    expect(out.spec.files['/tokens.css']).toContain('--color-1: #e11d48;');
  });

  it('reports override ids that match no token on this component', () => {
    const out = customizeArtifact(artifact, {
      tokenOverrides: { t1: '#000', ghost: '#fff' },
      propValues: {},
    });
    expect(out.appliedTokenOverrides).toEqual({ t1: '#000' });
    expect(out.unknownTokenIds).toEqual(['ghost']);
    expect(out.tokensCss).not.toContain('#fff');
  });

  it('merges prop values into the customized spec entry', () => {
    const out = customizeArtifact(artifact, {
      tokenOverrides: {},
      propValues: { variant: 'secondary' },
    });
    expect(out.spec.files['/index.tsx']).toContain('"variant": "secondary"');
    expect(out.appliedPropValues).toEqual({ variant: 'secondary' });
  });

  it('emits a copyable design rule named after the component', () => {
    const out = customizeArtifact(artifact, {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { background: '#000', radius: '12' },
    });
    expect(out.designCss).toContain('.MyButton {');
    expect(out.designCss).toContain('background: #000;');
    expect(out.designCss).toContain('border-radius: 12px;');
    expect(out.appliedDesignOverrides).toEqual({ background: '#000', radius: '12' });
  });

  it('produces an empty design rule when no design overrides are set', () => {
    const out = customizeArtifact(artifact, { tokenOverrides: {}, propValues: {} });
    expect(out.designCss).toBe('');
    expect(out.appliedDesignOverrides).toEqual({});
    expect(out.unknownDesignFields).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  // Regression (Q3): unknown design keys used to be echoed back as "applied"
  // while emitting nothing, so `borderRadius: '8'` looked like it had worked.
  it('reports design keys that name no known field instead of echoing them back', () => {
    const out = customizeArtifact(artifact, {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { radius: '12', borderRadius: '8', 'hover:color': '#222', 'hover:nope': 'x' },
    });
    expect(out.appliedDesignOverrides).toEqual({ radius: '12', 'hover:color': '#222' });
    expect(out.unknownDesignFields).toEqual(['borderRadius', 'hover:nope']);
    expect(out.designCss).toContain('border-radius: 12px;');
    expect(out.designCss).toContain('.MyButton:hover {');
    expect(out.designCss).not.toContain('8px');
  });

  it('surfaces entry-patch warnings instead of dropping them', () => {
    const broken = artifactWith({ '/index.tsx': 'const other = {};\n' }, 'MyButton');
    const out = customizeArtifact(broken, { tokenOverrides: {}, propValues: { a: 1 } });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/props/i);
  });
});
