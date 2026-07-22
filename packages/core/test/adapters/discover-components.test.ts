import { describe, it, expect } from 'vitest';
import { discoverComponents } from '../../src/adapters/react/discover-components.js';
import { nameFromFilePath } from '../../src/adapters/react/node-utils.js';
import { inMemoryHandle } from './in-memory-handle.js';

function discover(files: Readonly<Record<string, string>>): string[] {
  const { handle } = inMemoryHandle(files);
  return discoverComponents(handle).map((d) => d.name);
}

describe('discoverComponents — styled-components / emotion', () => {
  it('discovers a styled factory, which contains no JSX at all', () => {
    // Before this, a styled-components codebase scanned to an empty gallery:
    // `componentBodyOf` returned null for a tagged template.
    const names = discover({
      '/proj/src/Tag.tsx': [
        `import styled from 'styled-components';`,
        'export const Tag = styled.span`color: red;`;',
      ].join('\n'),
    });
    expect(names).toEqual(['Tag']);
  });

  it('discovers the styled(Component) and .attrs() tag shapes', () => {
    const names = discover({
      '/proj/src/Tag.tsx': [
        `import styled from 'styled-components';`,
        'export const Base = styled.span`color: red;`;',
        'export const Fancy = styled(Base)`font-weight: 700;`;',
        'export const Input = styled.input.attrs({ type: "text" })`border: 0;`;',
      ].join('\n'),
    });
    expect(names.sort()).toEqual(['Base', 'Fancy', 'Input']);
  });

  it('discovers a styled factory exported directly as the default', () => {
    // ts-morph hands back the TaggedTemplateExpression ITSELF here — there is no
    // VariableDeclaration to look inside — so a dispatch that only inspects
    // variable initializers falls through to null and the component vanishes.
    const names = discover({
      '/proj/src/Panel.tsx': [
        `import styled from 'styled-components';`,
        'export default styled.div`color: red;`;',
      ].join('\n'),
    });
    expect(names).toEqual(['Panel']);
  });

  it('discovers a default-exported styled(Component) wrapper', () => {
    const names = discover({
      '/proj/src/Base.tsx': [
        `import styled from 'styled-components';`,
        'export const Base = styled.span`color: red;`;',
      ].join('\n'),
      '/proj/src/fancy-base/index.tsx': [
        `import styled from 'styled-components';`,
        `import { Base } from '../Base';`,
        'export default styled(Base)`font-weight: 700;`;',
      ].join('\n'),
    });
    expect(names.sort()).toEqual(['Base', 'FancyBase']);
  });

  it('does not mistake a default-exported non-styled tagged template for a component', () => {
    const names = discover({
      '/proj/src/Query.tsx': ['export default gql`{ me { id } }`;'].join('\n'),
    });
    expect(names).toEqual([]);
  });

  it('does not mistake other tagged templates for components', () => {
    const names = discover({
      '/proj/src/Styles.ts': [
        `import { css, keyframes } from 'styled-components';`,
        'export const Reset = css`margin: 0;`;',
        'export const FadeIn = keyframes`from { opacity: 0; }`;',
        'export const Query = gql`{ me { id } }`;',
      ].join('\n'),
    });
    expect(names).toEqual([]);
  });
});

describe('discoverComponents — anonymous default exports', () => {
  it('names an anonymous default export after its file', () => {
    // `isPascalCase('default')` is false, so these used to be dropped entirely.
    const names = discover({
      '/proj/src/Hero.tsx': 'export default () => <span/>;',
    });
    expect(names).toEqual(['Hero']);
  });

  it('names an index.tsx default export after its folder', () => {
    const names = discover({
      '/proj/src/hero-banner/index.tsx': 'export default function () { return <b/>; }',
    });
    expect(names).toEqual(['HeroBanner']);
  });

  it('still skips a default export whose file name is not a component name', () => {
    const names = discover({ '/proj/src/1.tsx': 'export default () => <span/>;' });
    expect(names).toEqual([]);
  });
});

describe('nameFromFilePath', () => {
  it.each([
    ['/a/b/Hero.tsx', 'Hero'],
    ['/a/b/hero.tsx', 'Hero'],
    ['/a/b/hero-banner.tsx', 'HeroBanner'],
    ['/a/b/hero_banner.jsx', 'HeroBanner'],
    ['/a/HeroBanner/index.tsx', 'HeroBanner'],
    ['/a/hero-banner/Index.tsx', 'HeroBanner'],
  ])('%s → %s', (filePath, expected) => {
    expect(nameFromFilePath(filePath)).toBe(expected);
  });

  it('returns null when no component name can be derived', () => {
    expect(nameFromFilePath('/a/b/404.tsx')).toBeNull();
    expect(nameFromFilePath('/index.tsx')).toBeNull();
  });
});
