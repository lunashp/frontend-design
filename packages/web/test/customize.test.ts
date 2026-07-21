import { describe, it, expect } from 'vitest';
import {
  emitRootCss,
  patchEntryProps,
  injectTokenOverrides,
  customizeSpec,
} from '../src/lib/customize.js';
import { emitDesignCss, emitDesignRule } from '../src/lib/design-overrides.js';
import type { ComponentArtifact, Token } from '../src/api/types.js';

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

describe('emitRootCss', () => {
  it('emits :root defaults and applies overrides by token id', () => {
    expect(emitRootCss(TOKENS, {})).toContain('--color-1: #3b82f6;');
    expect(emitRootCss(TOKENS, { t1: '#ff0000' })).toContain('--color-1: #ff0000;');
  });
  it('handles no tokens', () => {
    expect(emitRootCss([], {})).toBe(':root {\n}\n');
  });
});

describe('patchEntryProps', () => {
  const entry = 'const props = {\n  "variant": "primary",\n  "size": "sm"\n};\n';
  it('merges prop values into the props literal', () => {
    const out = patchEntryProps(entry, { variant: 'secondary' });
    expect(out).toContain('"variant": "secondary"');
    expect(out).toContain('"size": "sm"');
  });
  it('is a no-op with no prop values', () => {
    expect(patchEntryProps(entry, {})).toBe(entry);
  });
});

describe('injectTokenOverrides', () => {
  const entry = 'const props = {};\nconst root = createRoot(el);\nroot.render(<C {...props} />);\n';
  it('injects setProperty calls for overridden tokens before mount', () => {
    const out = injectTokenOverrides(entry, TOKENS, { t1: '#e11d48' });
    expect(out).toContain('setProperty');
    expect(out).toContain('--color-1');
    expect(out).toContain('#e11d48');
    // Injected before the createRoot call.
    expect(out.indexOf('setProperty')).toBeLessThan(out.indexOf('createRoot'));
  });
  it('is a no-op with no overrides', () => {
    expect(injectTokenOverrides(entry, TOKENS, {})).toBe(entry);
  });
});

describe('customizeSpec', () => {
  const artifact = {
    tokenModel: { tokens: TOKENS },
    sandpack: {
      files: {
        '/index.tsx': 'const props = {};\nconst root = createRoot(el);',
        '/tokens.css': ':root {\n  --color-1: #3b82f6;\n}\n',
      },
      entryPath: '/index.tsx',
      template: 'react-ts',
      dependencies: {},
      renderability: 'full',
      notes: [],
    },
  } as unknown as ComponentArtifact;

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
  it('resolves shadow presets and opacity', () => {
    expect(emitDesignCss({ shadow: 'md' })).toContain('box-shadow: 0 4px 12px');
    expect(emitDesignCss({ opacity: '50' })).toContain('opacity: 0.5 !important;');
    expect(emitDesignCss({ opacity: '100' })).toBe('');
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
  it('is empty when nothing is set', () => {
    expect(emitDesignRule('X', {})).toBe('');
  });
});
