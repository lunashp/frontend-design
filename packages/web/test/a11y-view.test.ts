/**
 * Pure view mapping for the inspector's Accessibility section: axe impact ->
 * visual tone, and the impact summary -> the ordered, non-zero chip list. Both
 * are pure, so they are unit-tested with no DOM.
 */

import { describe, it, expect } from 'vitest';
import type { A11ySummary } from '../src/api/types.js';
import { impactTone, summaryChips, totalIssues } from '../src/features/inspector/a11y-view.js';

const ZERO: A11ySummary = { critical: 0, serious: 0, moderate: 0, minor: 0 };

describe('impactTone', () => {
  it('maps the two severe impacts to the danger tone', () => {
    expect(impactTone('critical')).toBe('danger');
    expect(impactTone('serious')).toBe('danger');
  });

  it('maps moderate to warn and minor to note', () => {
    expect(impactTone('moderate')).toBe('warn');
    expect(impactTone('minor')).toBe('note');
  });
});

describe('totalIssues', () => {
  it('sums every impact bucket', () => {
    expect(totalIssues({ critical: 2, serious: 1, moderate: 3, minor: 4 })).toBe(10);
  });

  it('is zero for a clean pass', () => {
    expect(totalIssues(ZERO)).toBe(0);
  });
});

describe('summaryChips', () => {
  it('emits one chip per NON-ZERO bucket, most severe first', () => {
    const chips = summaryChips({ critical: 1, serious: 0, moderate: 2, minor: 5 });
    expect(chips.map((c) => c.impact)).toEqual(['critical', 'moderate', 'minor']);
    expect(chips.map((c) => c.count)).toEqual([1, 2, 5]);
  });

  it('carries the tone and a human label per chip', () => {
    const [critical] = summaryChips({ ...ZERO, critical: 3 });
    expect(critical?.tone).toBe('danger');
    expect(critical?.label.toLowerCase()).toContain('critical');
    expect(critical?.count).toBe(3);
  });

  it('is empty for a clean pass — no zero-count chips', () => {
    expect(summaryChips(ZERO)).toEqual([]);
  });

  it('keeps severity order even when only lower impacts are present', () => {
    const chips = summaryChips({ critical: 0, serious: 4, moderate: 0, minor: 1 });
    expect(chips.map((c) => c.impact)).toEqual(['serious', 'minor']);
  });
});
