/**
 * Why a component is code-only, in the user's terms — so the message is a
 * specific explanation, not one generic "can't render" line.
 *
 * The dominant reason is derived from the bundle the engine already reports
 * (its external deps, warnings, and dangling imports); no new engine field is
 * needed. The one that matters most is a genuine SERVER COMPONENT: it runs on
 * the server and can't be reproduced by an isolated client preview — an
 * architectural fact about the component, not a shortcoming of the tool, so it
 * is said plainly rather than lumped in with "too complex to bundle".
 *
 * Pure: unit-tested without a DOM.
 */

import type { PortableBundle } from '../../api/types.js';

export type CodeOnlyKind =
  | 'server-component'
  | 'node-runtime'
  | 'unresolvable-deps'
  | 'incomplete'
  | 'complex';

export interface CodeOnlyReason {
  readonly kind: CodeOnlyKind;
  readonly headline: string;
  readonly detail: string;
}

// Mirrors the engine's UNSANDBOXABLE / UNRESOLVABLE_VERSION split
// (sandbox-scaffolder.ts), read from the bundle the web already holds.
const NEXT = /^next(\/|$)/;
const REACT_DOM_SERVER = /^react-dom\/server/;
const NODE_BUILTIN = /^(node:|fs$|path$|crypto$|os$)/;
const UNINSTALLABLE_VERSION = /^(workspace:|catalog:|link:|file:|portal:|git\+|github:|https?:)/;

const PORTABLE_TAIL = 'Its full source and dependency list are on the Portable tab.';

export function classifyCodeOnly(bundle: PortableBundle): CodeOnlyReason {
  const deps = bundle.externalDeps ?? {};
  const depNames = Object.keys(deps);
  const warnings = bundle.warnings ?? [];

  // 1. A genuine server component — the honest architectural floor. Signalled by
  //    the engine's own "server-only Next.js modules" warning, or an unstubbed
  //    `next/*` / `react-dom/server` import surviving into the install list.
  const serverOnlyWarning = warnings.some((w) => /server-only Next\.js modules/i.test(w));
  if (serverOnlyWarning || depNames.some((n) => NEXT.test(n) || REACT_DOM_SERVER.test(n))) {
    return {
      kind: 'server-component',
      headline: 'This is a Server Component.',
      detail:
        'It runs on the server — reading server-only APIs (headers, cookies, routing, ' +
        'the filesystem) and rendering data-driven markup — which an isolated client ' +
        `preview can’t reproduce. ${PORTABLE_TAIL}`,
    };
  }

  // 2. Needs a Node.js runtime (filesystem, crypto, …) — no browser equivalent.
  if (depNames.some((n) => NODE_BUILTIN.test(n))) {
    return {
      kind: 'node-runtime',
      headline: 'Runs in a Node.js runtime.',
      detail: `It uses Node built-ins (filesystem, crypto, …) a browser sandbox has no equivalent for. ${PORTABLE_TAIL}`,
    };
  }

  // 3. Depends on a package pinned to a version a registry can't fetch (a
  //    workspace/local monorepo dep).
  const uninstallable = Object.entries(deps)
    .filter(([, version]) => UNINSTALLABLE_VERSION.test(version))
    .map(([name]) => name);
  if (uninstallable.length > 0) {
    return {
      kind: 'unresolvable-deps',
      headline: 'Depends on packages the sandbox can’t install.',
      detail:
        `It requires ${uninstallable.join(', ')} at a workspace/local version no registry ` +
        `can fetch. ${PORTABLE_TAIL}`,
    };
  }

  // 4. Part of the subtree couldn't be resolved (a mixed JS/TS boundary, an
  //    unresolved alias) so it can't be assembled whole.
  if (bundle.incomplete && (bundle.danglingImports?.length ?? 0) > 0) {
    return {
      kind: 'incomplete',
      headline: 'Some of its imports couldn’t be resolved.',
      detail: `Part of the component’s file subtree is missing, so it can’t be assembled whole. ${PORTABLE_TAIL}`,
    };
  }

  // 5. Nothing specific — a composition larger than the sandbox builds.
  return {
    kind: 'complex',
    headline: 'Too large to bundle for an isolated preview.',
    detail: `This composition pulls in more files than the sandbox assembles. ${PORTABLE_TAIL}`,
  };
}
