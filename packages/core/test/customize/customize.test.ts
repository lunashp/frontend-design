import { describe, it, expect } from 'vitest';
import {
  patchEntryProps,
  injectTokenOverrides,
  customizeSpec,
  customizeArtifact,
} from '../../src/customize/customize-artifact.js';
import { emitDesignCss, emitDesignRule } from '../../src/customize/design-overrides.js';
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

describe('emitDesignRule (copyable CSS)', () => {
  it('emits a named rule without !important', () => {
    const rule = emitDesignRule('MyButton', { color: '#111', radius: '8' });
    expect(rule).toContain('.MyButton {');
    expect(rule).toContain('color: #111;');
    expect(rule).toContain('border-radius: 8px;');
    expect(rule).not.toContain('!important');
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
  });
});
