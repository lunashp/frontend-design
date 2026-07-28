/**
 * Taxonomy metadata — the semantic color system. Atomic rank is the primary
 * classification and drives the palette; kind is secondary signposting.
 */

import type { AtomicLevel, ComponentKind, ComponentRole, ControlKind } from '../api/types.js';

export interface RankMeta {
  label: string;
  colorVar: string;
  blurb: string;
}

export const RANKS: Record<AtomicLevel, RankMeta> = {
  atom: { label: 'Atom', colorVar: 'var(--rank-atom)', blurb: 'Leaf element, no child components' },
  molecule: {
    label: 'Molecule',
    colorVar: 'var(--rank-molecule)',
    blurb: 'Small composition of atoms',
  },
  organism: {
    label: 'Organism',
    colorVar: 'var(--rank-organism)',
    blurb: 'Larger, often data-driven section',
  },
  page: { label: 'Page', colorVar: 'var(--rank-page)', blurb: 'Full screen or route' },
};

export const RANK_ORDER: readonly AtomicLevel[] = ['atom', 'molecule', 'organism', 'page'];

export const KIND_LABEL: Record<ComponentKind, string> = {
  presentational: 'Presentational',
  container: 'Container',
  layout: 'Layout',
};

/**
 * What a component is FOR. A full `Record` so a new role fails typecheck here
 * until it is given a label, rather than rendering a raw enum value. `other` is
 * the "no confident role" catch-all and IS labelled for completeness, but
 * `roleLabel` below hides it: an "Other" tag on a card is noise, not a fact.
 */
export const ROLE_LABEL: Record<ComponentRole, string> = {
  'form-control': 'Form control',
  'data-display': 'Data display',
  navigation: 'Navigation',
  feedback: 'Feedback',
  action: 'Action',
  layout: 'Layout',
  other: 'Other',
};

/**
 * The roles worth showing/filtering, in reading order — everything except
 * `other`. `action` leads because it is the most common interactive role; the
 * grouping otherwise runs interactive → structural.
 */
export const ROLE_ORDER: readonly ComponentRole[] = [
  'action',
  'form-control',
  'data-display',
  'navigation',
  'feedback',
  'layout',
];

/**
 * The label to DISPLAY for a role, or null when there is nothing worth showing:
 * a missing role (older payload / hand-built summary) or the `other` catch-all.
 * Callers render the tag only when this is non-null.
 */
export function roleLabel(role: ComponentRole | undefined): string | null {
  if (role === undefined || role === 'other') return null;
  return ROLE_LABEL[role];
}

export const CONTROL_GLYPH: Record<ControlKind, string> = {
  boolean: '◧',
  enum: '≡',
  string: 'T',
  number: '#',
  color: '◐',
  node: '⧉',
  unknown: 'ƒ',
};

/** Map a 0..~10 context score to a 0..1 "load" ratio for the meter. */
export function contextLoad(score: number): number {
  return Math.min(1, score / 8);
}

export function contextLoadLabel(score: number): string {
  if (score === 0) return 'Isolated';
  if (score <= 2) return 'Light context';
  if (score <= 5) return 'Needs context';
  return 'Heavy context';
}
