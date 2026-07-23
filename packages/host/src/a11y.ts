/**
 * Pure accessibility-audit policy — the decisions that must NOT depend on a
 * browser being present, so they live apart from the auditor and are unit-tested
 * directly:
 *
 *   - shouldAuditA11y short-circuits a component that cannot render at all
 *     (code-only), so we never pay for a Chromium launch to audit a page that
 *     can't exist.
 *   - a11yCacheKey names the on-disk JSON audit by the SAME bundle content the
 *     thumbnail cache keys on (width dropped — axe reads the DOM, not the pixels),
 *     so a re-scan that changes the bundle re-audits and an unchanged one re-hits.
 *   - summarizeAxe collapses a raw axe violation list into a compact, bounded,
 *     impact-ranked report with an honest disclosure — the payload the API and MCP
 *     both hand out.
 *
 * The whole point of the feature is HONESTY: the audit runs against the rendered
 * PREVIEW (a stubbed component is wrapped in faked context), so the report always
 * carries a disclosure saying so, and is framed as advisory — issues to check,
 * never a pass/fail gate that would hide a component.
 */

import { shortHash, type Renderability, type SandpackSpec } from '@ce/core';

/** The four axe impact levels, most to least severe. null/unknown normalizes to minor. */
export type A11yImpact = 'critical' | 'serious' | 'moderate' | 'minor';

/** Findings above this count are dropped from the list (summary counts stay complete). */
export const DEFAULT_MAX_FINDINGS = 20;

/** Affected-target samples carried per finding — enough to point at, not to dump the DOM. */
export const MAX_TARGETS_PER_FINDING = 3;

/**
 * One axe violation, already compacted in-page to exactly what the report needs:
 * the rule, its impact, a short help line + url, how many nodes it hit, and a
 * small sample of their CSS-selector targets. Produced by the browser-side
 * auditor and consumed by summarizeAxe — the seam that keeps summarization pure.
 */
export interface AxeViolationRaw {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly helpUrl: string;
  /** Total DOM nodes this rule flagged (may exceed targets.length). */
  readonly nodeCount: number;
  /** A bounded sample of the affected element selectors. */
  readonly targets: readonly string[];
}

/** One finding in the report: the same fields, with a normalized impact. */
export interface A11yFinding {
  readonly ruleId: string;
  readonly impact: A11yImpact;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodeCount: number;
  readonly targets: readonly string[];
}

/** Violation counts by impact — always complete, even when the findings list is truncated. */
export interface A11ySummary {
  readonly critical: number;
  readonly serious: number;
  readonly moderate: number;
  readonly minor: number;
}

/** A completed audit — the available:true branch of the API/MCP response. */
export interface A11yReport {
  readonly available: true;
  /** The verdict the render used: full or stubbed (never code-only here). */
  readonly renderability: Renderability;
  /** True when app context was faked — some ARIA/role findings may be stub artifacts. */
  readonly stubbedContext: boolean;
  readonly summary: A11ySummary;
  /** Violations found before truncation — the honest total behind a capped list. */
  readonly total: number;
  readonly findings: readonly A11yFinding[];
  readonly truncated: boolean;
  /** The advisory / stubbed-context caveat, carried on the wire so no consumer can drop it. */
  readonly disclosure: string;
}

/** Why an audit could not be produced — a definitive, non-error outcome. */
export type A11yUnavailableReason = 'code-only' | 'unavailable';

/** The available:false branch — degradation is never a 500 or a hang. */
export interface A11yUnavailable {
  readonly available: false;
  readonly reason: A11yUnavailableReason;
  readonly disclosure: string;
}

export type A11yResponse = A11yReport | A11yUnavailable;

/**
 * Whether a component can be audited without even trying a browser. code-only
 * cannot render in isolation — the engine already decided that — so there is
 * nothing to run axe against.
 */
export function shouldAuditA11y(renderability: Renderability): boolean {
  return renderability !== 'code-only';
}

export interface A11yKeyInput {
  readonly componentId: string;
  readonly spec: SandpackSpec;
}

/**
 * The width-INDEPENDENT identity of a bundle: sorted files + sorted deps + entry.
 * Built with string concatenation (not template interpolation) and joined on
 * distinct separators so two different key/value splits cannot collide. This is
 * the audit's cache basis — the same bundle content the thumbnail cache keys on,
 * minus the pixel width axe does not care about.
 */
function bundleFingerprint(spec: SandpackSpec): string {
  const files = Object.keys(spec.files)
    .sort()
    .map((p) => p + '\t' + spec.files[p])
    .join('\n');
  const deps = Object.keys(spec.dependencies)
    .sort()
    .map((d) => d + '@' + spec.dependencies[d])
    .join('\n');
  return ['entry=' + spec.entryPath, 'deps=' + deps, 'files=' + files].join('\n\n');
}

/**
 * A filesystem-safe cache stem: idHash + '-' + bundleHash. The id is hashed (ids
 * carry / . and # that would escape the cache dir) and the bundle hash covers the
 * whole render input, so a changed bundle re-audits and an unchanged one re-hits,
 * just like the thumbnail cache minus the pixel dimension axe ignores.
 */
export function a11yCacheKey(input: A11yKeyInput): string {
  const idHash = shortHash(input.componentId, 8);
  const bundleHash = shortHash(bundleFingerprint(input.spec), 24);
  return idHash + '-' + bundleHash;
}

/** axe leaves impact null on some rules; treat null/unknown as least-severe so it is still ranked, never dropped. */
export function normalizeImpact(raw: string | null | undefined): A11yImpact {
  return raw === 'critical' || raw === 'serious' || raw === 'moderate' || raw === 'minor'
    ? raw
    : 'minor';
}

const IMPACT_RANK: Readonly<Record<A11yImpact, number>> = {
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
};

export interface SummarizeOptions {
  readonly renderability: Renderability;
  readonly maxFindings?: number;
}

const ADVISORY =
  'Advisory only — these come from the component rendered as a live preview, not from a source scan. ' +
  'Contrast and structural findings are genuine; treat them as issues to check, not a pass/fail gate.';

const STUBBED_CAVEAT =
  ' The preview stubbed the app context, so some ARIA/role findings may be artifacts of the stub rather than the component itself.';

function reportDisclosure(stubbedContext: boolean): string {
  return stubbedContext ? ADVISORY + STUBBED_CAVEAT : ADVISORY;
}

const UNAVAILABLE_DISCLOSURE: Readonly<Record<A11yUnavailableReason, string>> = {
  'code-only':
    "This component can't render in isolation (code-only), so there is nothing to audit against — review its source by hand.",
  unavailable:
    'The accessibility audit renders the component in a headless browser, which is not available here. ' +
    'The audit is unavailable; every other tab still works.',
};

/** The disclosure that rides on an available:false response. */
export function unavailableDisclosure(reason: A11yUnavailableReason): string {
  return UNAVAILABLE_DISCLOSURE[reason];
}

/**
 * Collapse raw axe violations into a compact report: count EVERY violation by
 * impact, then rank the findings (impact desc, then node count desc, then rule id)
 * and keep the top N. The summary is always complete even when the list is cut,
 * and a buried critical is guaranteed to survive truncation because ranking runs
 * before the slice.
 */
export function summarizeAxe(
  violations: readonly AxeViolationRaw[],
  options: SummarizeOptions,
): A11yReport {
  const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
  const stubbedContext = options.renderability === 'stubbed';

  const summary = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) summary[normalizeImpact(v.impact)] += 1;

  const ranked: A11yFinding[] = violations
    .map((v) => ({
      ruleId: v.id,
      impact: normalizeImpact(v.impact),
      help: v.help,
      helpUrl: v.helpUrl,
      nodeCount: v.nodeCount,
      targets: v.targets.slice(0, MAX_TARGETS_PER_FINDING),
    }))
    .sort(
      (a, b) =>
        IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] ||
        b.nodeCount - a.nodeCount ||
        a.ruleId.localeCompare(b.ruleId),
    );

  return {
    available: true,
    renderability: options.renderability,
    stubbedContext,
    summary,
    total: violations.length,
    findings: ranked.slice(0, maxFindings),
    truncated: violations.length > maxFindings,
    disclosure: reportDisclosure(stubbedContext),
  };
}
