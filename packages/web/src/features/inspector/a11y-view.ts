/**
 * Pure view mapping for the inspector's Accessibility section. Kept out of the
 * component so the impact->tone mapping and the summary->chip list are
 * unit-testable without a DOM — the section just renders these.
 */

import type { A11yImpact, A11ySummary } from '../../api/types.js';

/** Visual severity tones the section paints with — mapped from axe impact. */
export type A11yTone = 'danger' | 'warn' | 'note';

/** critical/serious are blockers (danger), moderate is a caution (warn), minor is a note. */
export function impactTone(impact: A11yImpact): A11yTone {
  switch (impact) {
    case 'critical':
    case 'serious':
      return 'danger';
    case 'moderate':
      return 'warn';
    default:
      return 'note';
  }
}

/** Total violations across every impact bucket. */
export function totalIssues(summary: A11ySummary): number {
  return summary.critical + summary.serious + summary.moderate + summary.minor;
}

/** One summary chip: an impact bucket with a non-zero count, its tone and a label. */
export interface A11ySummaryChip {
  readonly impact: A11yImpact;
  readonly count: number;
  readonly tone: A11yTone;
  readonly label: string;
}

/** Fixed most-to-least-severe order so the chip row always reads worst-first. */
const IMPACT_ORDER: readonly A11yImpact[] = ['critical', 'serious', 'moderate', 'minor'];

const IMPACT_LABEL: Readonly<Record<A11yImpact, string>> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};

/** One chip per NON-ZERO impact bucket, most severe first — empty on a clean pass. */
export function summaryChips(summary: A11ySummary): A11ySummaryChip[] {
  return IMPACT_ORDER.filter((impact) => summary[impact] > 0).map((impact) => ({
    impact,
    count: summary[impact],
    tone: impactTone(impact),
    label: IMPACT_LABEL[impact],
  }));
}
