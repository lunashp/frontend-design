/**
 * Taxonomy metadata — the semantic color system. Atomic rank is the primary
 * classification and drives the palette; kind is secondary signposting.
 */

import type { AtomicLevel, ComponentKind, ControlKind } from '../api/types.js';

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
