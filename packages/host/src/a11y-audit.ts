/**
 * The browser-side accessibility auditor: it injects axe-core into the SAME
 * rendered preview page the thumbnail uses (via the shared render pool) and runs
 * axe against it, returning a compact raw-violation list.
 *
 * Why axe against the real render, not static JSX heuristics: hand-rolled a11y
 * checks over arbitrary components (spread props, custom wrappers, dynamic
 * children) cry wolf — a false positive that flags correct code is itself a
 * misleading bug. axe is battle-tested and low-false-positive, and reads REAL
 * computed styles, so contrast findings are genuine in a way no static check can be.
 *
 * axe-core is PURE JS (no native, no browser needed to LOAD it), so it is a normal
 * always-present dependency — importing this module never fails. Only the BROWSER
 * degrades: if the shared pool cannot launch Chromium, or the render/axe run times
 * out, the auditor returns `null` and the route answers "unavailable". axe itself
 * is never a degrade condition.
 */

import axe from 'axe-core';
import type { Page } from 'playwright';
import type { SandpackSpec } from '@ce/core';
import { sharedRenderPool, type PageRenderer } from './render-pool.js';
import { MAX_TARGETS_PER_FINDING, type AxeViolationRaw } from './a11y.js';

/** A neutral desktop viewport — axe reads the DOM + computed styles, so the exact size only affects responsive layout. */
const AUDIT_VIEWPORT = { width: 1024, height: 768 };

/** setContent timeout (guards a component that never mounts). */
const AUDIT_LOAD_TIMEOUT_MS = 8000;

/** Hard ceiling on the axe run itself, so a pathological DOM can never hang the request. */
const AUDIT_RUN_TIMEOUT_MS = 12000;

export interface AuditInput {
  /** The scanned project root — read-only. */
  readonly targetRoot: string;
  readonly spec: SandpackSpec;
  /** Overrides the axe-run ceiling; the load timeout is fixed. */
  readonly runTimeoutMs?: number;
}

/**
 * Runs the audit and returns the raw violations, or `null` when the browser is
 * unavailable / the render or axe run failed or timed out. Injected into the
 * route so the contract can be tested with no browser.
 */
export type A11yAuditor = (input: AuditInput) => Promise<readonly AxeViolationRaw[] | null>;

/** Reject after `ms` so a stuck axe run degrades to `null` instead of hanging the request. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * The axe context + options, scoped so the audit is about the COMPONENT, not the
 * preview harness. Two deliberate scopings keep it honest:
 *
 *   - context '#root': axe only tests the mounted component subtree. Without this,
 *     document-level rules would flag the harness itself — the preview <html> has
 *     no lang and no <title> — in EVERY component's audit, pure false positives.
 *   - runOnly the WCAG tags: this drops axe's best-practice rules (region,
 *     landmark-one-main, page-has-heading-one) that judge a whole PAGE's shell, not
 *     an isolated fragment. What is left is exactly the component-level a11y the
 *     product promises: missing alt / label / name, contrast, ARIA validity.
 */
const AXE_CONTEXT = '#root';
const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  resultTypes: ['violations'],
};

/**
 * Inject axe and run it against the component root, returning ONLY violations,
 * already compacted to the fields the report needs. Compaction happens in-page so
 * axe's large result objects never cross the evaluate boundary — and the callback
 * touches no DOM global the host lib lacks (context is a CSS selector string).
 */
async function runAxe(page: Page): Promise<AxeViolationRaw[]> {
  // addScriptTag defines the axe global from the pure-JS source string; the
  // preview page sets no CSP, so the injected script runs.
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(
    (args: { context: string; options: unknown; maxTargets: number }) => {
      // The injected axe global; typed narrowly rather than reaching for any.
      const runner = (
        globalThis as unknown as {
          axe: {
            run: (
              context: unknown,
              options: unknown,
            ) => Promise<{
              violations: Array<{
                id: string;
                impact: string | null;
                help: string;
                helpUrl: string;
                nodes: Array<{ target: unknown[] }>;
              }>;
            }>;
          };
        }
      ).axe;
      return runner.run(args.context, args.options).then((result) =>
        result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          nodeCount: v.nodes.length,
          targets: v.nodes
            .slice(0, args.maxTargets)
            .map((n) => n.target.map((t) => String(t)).join(' ')),
        })),
      );
    },
    { context: AXE_CONTEXT, options: AXE_OPTIONS, maxTargets: MAX_TARGETS_PER_FINDING },
  );
}

/** Bind an auditor to a page renderer (the shared pool by default). */
export function createA11yAuditor(withPage: PageRenderer = sharedRenderPool.withPage): A11yAuditor {
  return (input) => {
    const runTimeoutMs = input.runTimeoutMs ?? AUDIT_RUN_TIMEOUT_MS;
    return withPage({
      targetRoot: input.targetRoot,
      spec: input.spec,
      viewport: AUDIT_VIEWPORT,
      timeoutMs: AUDIT_LOAD_TIMEOUT_MS,
      run: (page) => withTimeout(runAxe(page), runTimeoutMs, 'axe run'),
    });
  };
}

/** Process-wide default auditor: shares the singleton browser with the thumbnail renderer. */
export const auditA11y: A11yAuditor = createA11yAuditor();
