import { describe, it, expect } from 'vitest';
import {
  sourceArea,
  isDesignArea,
  relativeDir,
  directoryFacets,
  type SourceArea,
} from '../src/lib/source-area.js';
import type { ComponentSummary } from '../src/api/types.js';

// Areas are read from the DIRECTORY, because on a real target the noise is not
// distinguishable by kind: an SVG icon and a Button are both presentational
// atoms. Only the folder the author filed it under separates "our design system"
// (components/ui) from icons, page compositions, and app infrastructure.
describe('sourceArea', () => {
  const cases: [string, SourceArea][] = [
    // design system — the reusable UI lives under these
    ['src/components/dialogs/ConfirmDialog.tsx', 'design-system'],
    ['src/@core/components/Card.tsx', 'design-system'],
    ['src/components/layout/Header.tsx', 'design-system'], // under components/ wins over the "layout" word
    ['packages/ui/src/Button.tsx', 'design-system'],
    ['src/design-system/Chip.tsx', 'design-system'],
    ['src/widgets/StatTile.tsx', 'design-system'],
    // icons — an entire category of noise for someone hunting a Button
    ['src/assets/svg/landing/Airbnb.tsx', 'icons'],
    ['src/@menu/svg/ChevronRight.tsx', 'icons'],
    ['src/icons/CloseIcon.tsx', 'icons'],
    ['src/ui/ArrowIcon.tsx', 'icons'], // an *Icon file is an icon even under ui/
    // pages — route-level compositions, app-specific, not a design system
    ['src/views/pages/dashboard/APIUsageRatio.tsx', 'pages'],
    ['src/pages/Settings.tsx', 'pages'],
    ['src/screens/Home.tsx', 'pages'],
    ['app/[lang]/dashboard/page.tsx', 'pages'],
    // page-scoped building blocks: the outer page context wins over an inner
    // components/ folder (measured on a real target).
    ['src/page-components/PromptPage/components/AnswerBody.tsx', 'pages'],
    ['src/landing-pages/hero/Cta.tsx', 'pages'],
    // infra — HOCs, providers, style wrappers: app plumbing
    ['src/hocs/AuthGuard.tsx', 'infra'],
    ['src/libs/styles/AppReactToastify.tsx', 'infra'],
    ['src/@menu/styles/StyledMenu.tsx', 'infra'],
    ['src/providers/ThemeProvider.tsx', 'infra'],
    // layout — top-level layout shells (kept, but distinguishable)
    ['src/@layouts/BlankLayout.tsx', 'layout'],
    ['src/layouts/RootLayout.tsx', 'layout'],
    // other — nothing decisive
    ['src/Thing.tsx', 'other'],
  ];
  for (const [rel, area] of cases) {
    it(`${rel} -> ${area}`, () => {
      expect(sourceArea(rel)).toBe(area);
    });
  }

  it('is case- and @-prefix-insensitive on segments', () => {
    expect(sourceArea('src/Components/Dialog.tsx')).toBe('design-system');
    expect(sourceArea('src/@Core/Components/X.tsx')).toBe('design-system');
  });
});

describe('isDesignArea (what "design components only" keeps)', () => {
  it('keeps design-system, layout, and undecided; drops icons/pages/infra', () => {
    expect(isDesignArea('design-system')).toBe(true);
    expect(isDesignArea('layout')).toBe(true);
    expect(isDesignArea('other')).toBe(true);
    expect(isDesignArea('icons')).toBe(false);
    expect(isDesignArea('pages')).toBe(false);
    expect(isDesignArea('infra')).toBe(false);
  });
});

describe('relativeDir', () => {
  it('returns the POSIX directory of a file relative to the project root', () => {
    expect(relativeDir('/repo', '/repo/src/components/Button.tsx')).toBe('src/components');
    expect(relativeDir('/repo/', '/repo/src/a/b/C.tsx')).toBe('src/a/b');
  });
  it('returns "" for a file at the root', () => {
    expect(relativeDir('/repo', '/repo/App.tsx')).toBe('');
  });
});

function summary(id: string, filePath: string): ComponentSummary {
  return {
    descriptor: {
      id,
      name: id,
      filePath,
      exportName: id,
      isDefaultExport: false,
      loc: { file: filePath, line: 1, column: 0 },
    },
    classification: { atomicLevel: 'atom', kind: 'presentational', contextDependencyScore: 0 },
    signals: {
      hookNames: [],
      contextConsumers: [],
      childComponentCount: 0,
      propCount: 0,
      usesStore: false,
      usesDataFetching: false,
      usesRouter: false,
    },
    propModel: { props: [] },
  } as unknown as ComponentSummary;
}

describe('directoryFacets', () => {
  it('groups components by relative directory with counts, most-populated first', () => {
    const comps = [
      summary('a', '/r/src/components/Button.tsx'),
      summary('b', '/r/src/components/Card.tsx'),
      summary('c', '/r/src/assets/svg/Icon.tsx'),
    ];
    const facets = directoryFacets(comps, '/r');
    expect(facets[0]).toEqual({ dir: 'src/components', count: 2, area: 'design-system' });
    expect(facets.find((f) => f.dir === 'src/assets/svg')).toEqual({
      dir: 'src/assets/svg',
      count: 1,
      area: 'icons',
    });
  });
});
