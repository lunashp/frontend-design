/**
 * The card used to lead with `propModel.props.length` — 63 for CustomAvatar, 82
 * for CustomTextField — numbers that describe MUI, not the component. These
 * cover the two pure view helpers that make the own/inherited split readable:
 * the card's headline number and the inspector's grouping. Both are pure .ts,
 * so no DOM is needed (the web app has no jsdom).
 */

import { describe, it, expect } from 'vitest';
import type { PropControl, PropModel, PropOrigin } from '../src/api/types.js';
import { propSummary } from '../src/features/gallery/prop-summary.js';
import { groupPropsByOrigin } from '../src/features/inspector/prop-groups.js';

function prop(name: string, origin: PropOrigin, originPackage?: string): PropControl {
  return {
    name,
    tsType: 'string',
    kind: 'string',
    required: false,
    origin,
    ...(originPackage ? { originPackage } : {}),
  };
}

function model(props: PropControl[], ownPropCount: number | null): PropModel {
  return { props, ownPropCount };
}

// The real shape of CustomAvatar: 3 of its own, 60 from MUI/React.
const AVATAR = model(
  [
    prop('color', 'own'),
    prop('skin', 'own'),
    prop('size', 'own'),
    ...Array.from({ length: 9 }, (_, i) => prop(`mui${i}`, 'inherited', '@mui/material')),
    ...Array.from({ length: 51 }, (_, i) => prop(`react${i}`, 'inherited', '@types/react')),
  ],
  3,
);

describe('propSummary — the number the card leads with', () => {
  it('leads with the component’s own count, not the inherited total', () => {
    const s = propSummary(AVATAR);
    expect(s.lead).toBe(3);
    expect(s.total).toBe(63);
    expect(s.inherited).toBe(60);
    expect(s.determined).toBe(true);
  });

  it('says "own" only when there is an inherited surface to contrast with', () => {
    expect(propSummary(AVATAR).noun).toBe('own');
    // A plain component inherits nothing — "3 own props" would imply a
    // distinction that does not exist for it.
    const plain = model([prop('a', 'own'), prop('b', 'own')], 2);
    expect(propSummary(plain).noun).toBe('props');
    expect(propSummary(plain).inherited).toBe(0);
  });

  it('reports a pass-through wrapper as 0 own — a true statement, not a failure', () => {
    // CustomTextField: `forwardRef((props: TextFieldProps) => …)` adds nothing.
    const passthrough = model(
      Array.from({ length: 82 }, (_, i) => prop(`p${i}`, 'inherited', '@mui/material')),
      0,
    );
    const s = propSummary(passthrough);
    expect(s.determined).toBe(true);
    expect(s.lead).toBe(0);
    expect(s.inherited).toBe(82);
  });

  it('falls back to the plain total when the split was not determined', () => {
    // ownPropCount null = the props type could not be resolved. Showing "0" here
    // would assert the component declares nothing, which we do not know.
    const undetermined = model(
      [prop('a', 'unknown'), prop('b', 'unknown')],
      null,
    );
    const s = propSummary(undetermined);
    expect(s.determined).toBe(false);
    expect(s.lead).toBe(2);
    expect(s.noun).toBe('props');
  });

  it('singularises the noun', () => {
    expect(propSummary(model([prop('a', 'own')], 1)).noun).toBe('prop');
    expect(propSummary(model([], 0)).noun).toBe('props');
  });

  it('counts unclassified props separately from own', () => {
    const mixed = model([prop('a', 'own'), prop('b', 'inherited', 'x'), prop('c', 'unknown')], 1);
    const s = propSummary(mixed);
    expect(s.lead).toBe(1);
    expect(s.inherited).toBe(1);
    expect(s.unclassified).toBe(1);
  });

  it('explains the number in a title a reader can hover', () => {
    const t = propSummary(AVATAR).title;
    expect(t).toContain('3');
    expect(t).toContain('60');
    expect(t.toLowerCase()).toContain('inherit');
  });

  it('does not claim a split in the title when none was determined', () => {
    const t = propSummary(model([prop('a', 'unknown')], null)).title;
    expect(t.toLowerCase()).toContain('could not');
  });
});

describe('groupPropsByOrigin — the inspector reads the own API first', () => {
  it('puts own props first, then each library, then unclassified', () => {
    const groups = groupPropsByOrigin([
      prop('r1', 'inherited', '@types/react'),
      prop('ghost', 'unknown'),
      prop('m1', 'inherited', '@mui/material'),
      prop('round', 'own'),
      prop('m2', 'inherited', '@mui/material'),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      'own',
      '@mui/material',
      '@types/react',
      'unknown',
    ]);
  });

  it('keeps every prop — inherited ones are de-emphasised, never dropped', () => {
    const groups = groupPropsByOrigin(AVATAR.props);
    const kept = groups.flatMap((g) => g.props.map((p) => p.name));
    expect(kept).toHaveLength(AVATAR.props.length);
    expect(new Set(kept).size).toBe(AVATAR.props.length);
  });

  it('orders libraries by how much surface they contribute', () => {
    const groups = groupPropsByOrigin(AVATAR.props);
    expect(groups.map((g) => g.key)).toEqual(['own', '@types/react', '@mui/material']);
    expect(groups[0]?.props).toHaveLength(3);
    expect(groups[1]?.props).toHaveLength(51);
  });

  it('marks which group is the component’s own API', () => {
    const groups = groupPropsByOrigin([prop('a', 'own'), prop('b', 'inherited', 'lib')]);
    expect(groups[0]?.origin).toBe('own');
    expect(groups[0]?.label).toMatch(/own/i);
    expect(groups[1]?.origin).toBe('inherited');
    expect(groups[1]?.label).toBe('lib');
  });

  it('labels an inherited prop with no known package honestly', () => {
    const groups = groupPropsByOrigin([prop('a', 'inherited')]);
    expect(groups[0]?.origin).toBe('inherited');
    expect(groups[0]?.label).toMatch(/inherited/i);
  });

  it('emits no empty groups', () => {
    const groups = groupPropsByOrigin([prop('a', 'own')]);
    expect(groups).toHaveLength(1);
    expect(groupPropsByOrigin([])).toEqual([]);
  });
});
