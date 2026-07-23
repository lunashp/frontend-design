/**
 * Pure formatters for the kit view — the install command, dependency-conflict
 * lines, and a copy-all dump. Kept out of the React component so they are unit
 * tested directly (kit-format.test.ts) rather than through the DOM.
 */

import type { DepConflict } from '../../api/types.js';

/**
 * The install command for a kit's merged external deps, or `null` when the kit is
 * fully self-contained (so the caller renders a "no dependencies" note instead of
 * an empty command). Packages are sorted by name for a deterministic command
 * regardless of the engine's merge order, and each is pinned to its merged range
 * (`name@range`) — a kit's value is one honest, reproducible set of versions.
 * A conflicting package still resolves to a single range here (the engine picks
 * the smallest); the conflict itself is surfaced separately, never hidden.
 */
export function formatInstallCommand(deps: Record<string, string>): string | null {
  const names = Object.keys(deps).sort();
  if (names.length === 0) return null;
  const specs = names.map((name) => {
    const range = deps[name] ?? '';
    return range ? `${name}@${range}` : name;
  });
  return `npm install ${specs.join(' ')}`;
}

/**
 * One human-readable line per dependency conflict — a package two or more
 * components in the kit require at different ranges. Surfaced verbatim (not
 * silently reconciled) so the engineer can decide. `nameOf` resolves a component
 * id to its display name, falling back to the raw id when unknown.
 */
export function describeConflicts(
  conflicts: readonly DepConflict[],
  nameOf: (componentId: string) => string,
): string[] {
  return conflicts.map((conflict) => {
    const parts = conflict.requirements
      .map((r) => `${nameOf(r.componentId)} wants ${r.range}`)
      .join(', ');
    return `${conflict.package}: ${parts}`;
  });
}

/** One flat, copyable text blob of every file, each under a `// <path>` comment. */
export function kitFilesDump(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, code]) => `// ${path}\n${code}`)
    .join('\n\n');
}
