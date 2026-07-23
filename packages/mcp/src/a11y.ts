/**
 * Accessibility auditing for the MCP — the agent-facing sibling of the web host's
 * GET /api/a11y. The audit itself runs axe against a HEADLESS-browser render of
 * the component; that render backend lives in the web host (which owns the
 * browser). This standalone, publishable MCP package intentionally ships NO
 * browser and NO bundler (see package.json — playwright/esbuild are not runtime
 * deps), and duplicating the host's browser launch is explicitly out of scope, so:
 *
 *   - The audit is exposed as an INJECTABLE seam (`A11yAuditor`). A deployment
 *     that embeds this server alongside a render backend can wire the real
 *     auditor in via `createMcpServer({ auditA11y })`.
 *   - The default (`unavailableA11yAuditor`) returns a definitive, honest
 *     `no-render-backend` response that points the agent at the web host's audit,
 *     rather than pretending to run one or crashing.
 *
 * Either way the agent learns the SAME thing it would from the web inspector: the
 * findings are advisory, come from the RENDERED preview (stubbed context may add
 * or mask issues), and never gate a component out.
 */

import type { ComponentArtifact, Renderability, SandpackSpec } from '@ce/core';

/** The four axe impact levels, most to least severe. */
export type A11yImpact = 'critical' | 'serious' | 'moderate' | 'minor';

/** One advisory finding: the rule, its impact, a short help line + url, and where it hit. */
export interface A11yFinding {
  readonly ruleId: string;
  readonly impact: A11yImpact;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodeCount: number;
  readonly targets: readonly string[];
}

/** Violation counts by impact — complete even when the findings list is truncated. */
export interface A11ySummary {
  readonly critical: number;
  readonly serious: number;
  readonly moderate: number;
  readonly minor: number;
}

/** A completed audit — the available:true branch. Shape-compatible with the web host's report. */
export interface A11yReport {
  readonly available: true;
  readonly renderability: Renderability;
  /** True when app context was faked — some ARIA/role findings may be stub artifacts. */
  readonly stubbedContext: boolean;
  readonly summary: A11ySummary;
  readonly total: number;
  readonly findings: readonly A11yFinding[];
  readonly truncated: boolean;
  readonly disclosure: string;
}

/**
 * Why an audit could not be produced.
 *  - code-only         — the component cannot render in isolation, so nothing to audit.
 *  - no-render-backend — this MCP has no browser to render + audit in (the default).
 *  - unavailable       — an injected backend was present but the render/axe run failed.
 */
export type A11yUnavailableReason = 'code-only' | 'no-render-backend' | 'unavailable';

/** The available:false branch — a definitive, non-error outcome. */
export interface A11yUnavailable {
  readonly available: false;
  readonly reason: A11yUnavailableReason;
  readonly disclosure: string;
}

export type A11yResponse = A11yReport | A11yUnavailable;

/** How a component is audited — inputs are what the host auditor also needs. */
export type A11yAuditor = (input: {
  readonly targetRoot: string;
  readonly spec: SandpackSpec;
}) => Promise<A11yResponse>;

const CODE_ONLY_DISCLOSURE =
  "This component can't render in isolation (code-only), so there is nothing to audit against — review its source by hand.";

const NO_BACKEND_DISCLOSURE =
  'This MCP server has no rendering backend, so it cannot run the accessibility audit itself. ' +
  'Run the component through the Component Explorer web host (GET /api/a11y), which renders it in a ' +
  'headless browser and runs axe-core. Findings there are advisory and come from the rendered preview.';

/** The standalone default: no browser here, so report it plainly and say where the audit runs. */
export const unavailableA11yAuditor: A11yAuditor = async () => ({
  available: false,
  reason: 'no-render-backend',
  disclosure: NO_BACKEND_DISCLOSURE,
});

/** The compact get_accessibility payload: the component identity + the audit response. */
export interface AccessibilityResult {
  readonly id: string;
  readonly name: string;
  readonly renderability: Renderability;
}

export type Accessibility = AccessibilityResult & A11yResponse;

/**
 * Resolve the audit for one component: refuse code-only WITHOUT touching the
 * auditor (nothing renders, so nothing to audit), otherwise run the auditor and
 * fold its response together with the component identity. Pure over the injected
 * auditor, so the shaping and the code-only gate are unit-testable with no browser.
 */
export async function resolveAccessibility(
  artifact: ComponentArtifact,
  auditor: A11yAuditor,
  targetRoot: string,
): Promise<Accessibility> {
  const renderability = artifact.sandpack.renderability;
  const identity: AccessibilityResult = {
    id: artifact.descriptor.id,
    name: artifact.descriptor.name,
    renderability,
  };
  if (renderability === 'code-only') {
    return { ...identity, available: false, reason: 'code-only', disclosure: CODE_ONLY_DISCLOSURE };
  }
  const response = await auditor({ targetRoot, spec: artifact.sandpack });
  return { ...identity, ...response };
}
