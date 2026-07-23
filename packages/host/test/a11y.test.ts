/**
 * Pure accessibility-audit policy: the availability gate, the cache key, and the
 * axe-violation summarizer/truncator. None of these touch a browser, so they are
 * unit-tested here directly — the real axe run lives in e2e/a11y-audit.spec.ts,
 * deliberately kept out of `pnpm test`.
 */

import { describe, it, expect } from 'vitest';
import type { SandpackSpec } from '@ce/core';
import {
  DEFAULT_MAX_FINDINGS,
  a11yCacheKey,
  normalizeImpact,
  shouldAuditA11y,
  summarizeAxe,
  type AxeViolationRaw,
} from '../src/a11y.js';

function spec(overrides: Partial<SandpackSpec> = {}): SandpackSpec {
  return {
    files: { '/index.tsx': 'export default () => null;' },
    entryPath: '/index.tsx',
    template: 'react-ts',
    dependencies: {},
    renderability: 'full',
    notes: [],
    ...overrides,
  };
}

function violation(overrides: Partial<AxeViolationRaw> = {}): AxeViolationRaw {
  return {
    id: 'rule',
    impact: 'serious',
    help: 'Fix it',
    helpUrl: 'https://dequeuniversity.com/rules/axe/rule',
    nodeCount: 1,
    targets: ['button'],
    ...overrides,
  };
}

describe('shouldAuditA11y', () => {
  it('refuses a code-only component — it cannot render, so nothing to audit', () => {
    expect(shouldAuditA11y('code-only')).toBe(false);
  });

  it('audits full and stubbed components (both render)', () => {
    expect(shouldAuditA11y('full')).toBe(true);
    expect(shouldAuditA11y('stubbed')).toBe(true);
  });
});

describe('a11yCacheKey', () => {
  it('is stable for the same id and bundle — an unchanged re-scan hits the cache', () => {
    const a = a11yCacheKey({ componentId: 'c1', spec: spec() });
    const b = a11yCacheKey({ componentId: 'c1', spec: spec() });
    expect(a).toBe(b);
  });

  it('is independent of file-key order — the same bundle keyed differently is one audit', () => {
    const a = a11yCacheKey({ componentId: 'c1', spec: spec({ files: { '/a.tsx': 'A', '/b.tsx': 'B' } }) });
    const b = a11yCacheKey({ componentId: 'c1', spec: spec({ files: { '/b.tsx': 'B', '/a.tsx': 'A' } }) });
    expect(a).toBe(b);
  });

  it('changes when a file body changes — a changed bundle must re-audit, never read stale', () => {
    const a = a11yCacheKey({ componentId: 'c1', spec: spec({ files: { '/index.tsx': 'v1' } }) });
    const b = a11yCacheKey({ componentId: 'c1', spec: spec({ files: { '/index.tsx': 'v2' } }) });
    expect(a).not.toBe(b);
  });

  it('does NOT change with render width — axe reads the DOM, not the pixels', () => {
    // The audit is width-independent, unlike a thumbnail, so the key must not fold
    // width in: two card sizes share ONE audit.
    const a = a11yCacheKey({ componentId: 'c1', spec: spec() });
    const b = a11yCacheKey({ componentId: 'c1', spec: spec() });
    expect(a).toBe(b);
  });

  it('separates different components even with an identical spec', () => {
    const a = a11yCacheKey({ componentId: 'c1', spec: spec() });
    const b = a11yCacheKey({ componentId: 'c2', spec: spec() });
    expect(a).not.toBe(b);
  });

  it('is a filesystem-safe stem (no slashes/dots that would escape the cache dir)', () => {
    const key = a11yCacheKey({ componentId: 'src/components/Button.tsx#Button', spec: spec() });
    expect(key).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('normalizeImpact', () => {
  it('passes through the four impact levels', () => {
    expect(normalizeImpact('critical')).toBe('critical');
    expect(normalizeImpact('serious')).toBe('serious');
    expect(normalizeImpact('moderate')).toBe('moderate');
    expect(normalizeImpact('minor')).toBe('minor');
  });

  it('treats a null/unknown impact as the least severe rather than dropping it', () => {
    // axe leaves `impact` null on some violations; a finding must still be counted.
    expect(normalizeImpact(null)).toBe('minor');
    expect(normalizeImpact('bogus')).toBe('minor');
    expect(normalizeImpact(undefined)).toBe('minor');
  });
});

describe('summarizeAxe', () => {
  it('counts every violation by impact, regardless of the findings cap', () => {
    const report = summarizeAxe(
      [
        violation({ id: 'a', impact: 'critical' }),
        violation({ id: 'b', impact: 'critical' }),
        violation({ id: 'c', impact: 'serious' }),
        violation({ id: 'd', impact: 'moderate' }),
        violation({ id: 'e', impact: null }),
      ],
      { renderability: 'full' },
    );
    expect(report.available).toBe(true);
    expect(report.summary).toEqual({ critical: 2, serious: 1, moderate: 1, minor: 1 });
    expect(report.total).toBe(5);
  });

  it('orders findings by impact severity, most severe first', () => {
    const report = summarizeAxe(
      [
        violation({ id: 'minor-one', impact: 'minor' }),
        violation({ id: 'crit-one', impact: 'critical' }),
        violation({ id: 'mod-one', impact: 'moderate' }),
        violation({ id: 'serious-one', impact: 'serious' }),
      ],
      { renderability: 'full' },
    );
    expect(report.findings.map((f) => f.impact)).toEqual([
      'critical',
      'serious',
      'moderate',
      'minor',
    ]);
  });

  it('truncates to the top N by impact and discloses the cut', () => {
    const many: AxeViolationRaw[] = Array.from({ length: 25 }, (_, i) =>
      violation({ id: `rule-${i}`, impact: 'minor' }),
    );
    // A high-impact violation buried at the end must survive truncation.
    many.push(violation({ id: 'the-critical-one', impact: 'critical' }));
    const report = summarizeAxe(many, { renderability: 'full', maxFindings: 5 });
    expect(report.findings).toHaveLength(5);
    expect(report.truncated).toBe(true);
    expect(report.total).toBe(26);
    // The critical one led despite arriving last.
    expect(report.findings[0]?.ruleId).toBe('the-critical-one');
    expect(report.findings[0]?.impact).toBe('critical');
  });

  it('does not flag truncation when the findings fit under the cap', () => {
    const report = summarizeAxe([violation()], { renderability: 'full', maxFindings: DEFAULT_MAX_FINDINGS });
    expect(report.truncated).toBe(false);
    expect(report.findings).toHaveLength(1);
  });

  it('carries a clean pass honestly — zero findings, all counts zero', () => {
    const report = summarizeAxe([], { renderability: 'full' });
    expect(report.total).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.summary).toEqual({ critical: 0, serious: 0, moderate: 0, minor: 0 });
  });

  it('discloses stubbed context when the preview faked the app context', () => {
    const stubbed = summarizeAxe([violation()], { renderability: 'stubbed' });
    const full = summarizeAxe([violation()], { renderability: 'full' });
    expect(stubbed.stubbedContext).toBe(true);
    expect(full.stubbedContext).toBe(false);
    // The honest caveat must ride on the payload, not just live in the UI.
    expect(stubbed.disclosure.toLowerCase()).toContain('stub');
    // Both frame the audit as advisory against the RENDERED preview.
    expect(full.disclosure.toLowerCase()).toContain('preview');
  });

  it('normalizes each finding impact so a null-impact rule is still ranked', () => {
    const report = summarizeAxe([violation({ id: 'x', impact: null })], { renderability: 'full' });
    expect(report.findings[0]?.impact).toBe('minor');
  });
});
