/**
 * Turns the engine's renderability verdict into an honest badge.
 *
 * The old badge collapsed two different outcomes onto one label: a component
 * rendered inside the app's REAL theme and a component rendered bare with faked
 * context both showed as the same "render". That misleads whoever reads it — a
 * faithful render is trustworthy, a stubbed one is not. This helper splits them:
 *
 *   - full + real theme     → "Faithful render"  (what it actually looks like)
 *   - full + no theme        → "Isolated render"  (renders, but on placeholders)
 *   - stubbed                → "Stubbed render"   (context was faked; may look off)
 *   - code-only              → "Code only"        (cannot run live)
 *
 * It invents no state the engine doesn't report: the verdict is read straight
 * from `sandpack.renderability`, and the "what was stubbed" list from
 * `bundle.stubbedModules` — the same modules the engine already discloses.
 */

import type { ComponentArtifact, StubbedModule } from '../../api/types.js';

export type RenderTone = 'ok' | 'warn' | 'danger';

export interface RenderabilityLabel {
  tone: RenderTone;
  label: string;
  blurb: string;
  /** True when the app's own theme was wrapped around the render. */
  themeSupplied: boolean;
  /** One human line per module the sandbox swapped for a stub — the honest cost. */
  stubbed: string[];
}

/** e.g. `next/router → local stub (./__stubs__/next-router): client-side prefetch and route awareness`. */
function describeStub(s: StubbedModule): string {
  return `${s.specifier} → local stub (${s.replacedWith}): ${s.lost}`;
}

export function renderabilityLabel(artifact: ComponentArtifact): RenderabilityLabel {
  const themeSupplied = artifact.bundle.previewTheme !== undefined;
  const stubbed = artifact.bundle.stubbedModules.map(describeStub);

  switch (artifact.sandpack.renderability) {
    case 'code-only':
      return {
        tone: 'danger',
        label: 'Code only',
        blurb: "Can't run live in the sandbox — treat the files as reference code.",
        themeSupplied,
        stubbed,
      };
    case 'stubbed':
      return {
        tone: 'warn',
        label: 'Stubbed render',
        blurb: themeSupplied
          ? "Uses the app's real theme, but some app context was stubbed — behaviour may differ."
          : 'App context was faked — it may look or behave differently from the app.',
        themeSupplied,
        stubbed,
      };
    case 'full':
    default:
      return themeSupplied
        ? {
            tone: 'ok',
            label: 'Faithful render',
            blurb: "Rendered inside the app's real theme — this is how it looks in the app.",
            themeSupplied,
            stubbed,
          }
        : {
            tone: 'ok',
            label: 'Isolated render',
            blurb: 'Renders cleanly with no app context — colours are the component’s own defaults.',
            themeSupplied,
            stubbed,
          };
  }
}
