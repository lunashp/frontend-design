/**
 * `packages/web/src/api/types.ts` is a HAND-MAINTAINED mirror of the engine's
 * serialized contract — the web app talks to the JSON API only, so it cannot
 * import @ce/core (Node-only deps) and re-declares the DTOs instead. Nothing
 * enforces that, and it has drifted before.
 *
 * This parses both sides with ts-morph (the same compiler the engine already
 * depends on) and compares INTERFACE NAMES and their FIELD NAMES only. It
 * deliberately does not compare types: `readonly string[]` vs `string[]` and
 * `Readonly<Record<..>>` vs `Record<..>` are correct differences between an
 * immutable engine contract and a plain DTO, and asserting on them would make
 * the test noise rather than signal.
 *
 * The mirror is allowed EXTRA declarations (ApiError, ProgressEvent, …) — those
 * are transport concerns the engine has no opinion about.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { Project, type SourceFile } from 'ts-morph';

const CORE_TYPES_DIR = path.resolve(import.meta.dirname, '../../src/types');
const MIRROR_PATH = path.resolve(import.meta.dirname, '../../../web/src/api/types.ts');

/**
 * Core type modules whose interfaces cross the HTTP boundary and must therefore
 * exist in the mirror. `customization.ts` is deliberately absent: customization
 * state never travels over the API — the web app owns its own copy in
 * `packages/web/src/lib/customize.ts`, which is not this mirror.
 */
const MIRRORED_MODULES = [
  'component.ts',
  'prop-model.ts',
  'token-model.ts',
  'portable-bundle.ts',
  'sandpack-spec.ts',
  'artifact.ts',
] as const;

/** Interface name -> its own declared field names (inherited fields excluded). */
function interfaceFields(sf: SourceFile): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const decl of sf.getInterfaces()) {
    if (!decl.isExported()) continue;
    out.set(decl.getName(), new Set(decl.getProperties().map((p) => p.getName())));
  }
  return out;
}

function loadTypes(): { core: Map<string, Set<string>>; mirror: Map<string, Set<string>> } {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  });

  const core = new Map<string, Set<string>>();
  for (const mod of MIRRORED_MODULES) {
    const sf = project.addSourceFileAtPath(path.join(CORE_TYPES_DIR, mod));
    for (const [name, fields] of interfaceFields(sf)) core.set(name, fields);
  }
  const mirror = interfaceFields(project.addSourceFileAtPath(MIRROR_PATH));
  return { core, mirror };
}

const { core, mirror } = loadTypes();

describe('web DTO mirror stays in sync with the engine contract', () => {
  it('parses a non-trivial number of interfaces from both sides', () => {
    // Guards the test itself: a parsing regression would otherwise pass vacuously.
    expect(core.size).toBeGreaterThan(8);
    expect(mirror.size).toBeGreaterThan(8);
    expect(core.has('ComponentSummary')).toBe(true);
    expect(mirror.has('ComponentSummary')).toBe(true);
  });

  it('mirrors every exported engine interface', () => {
    const missing = [...core.keys()].filter((name) => !mirror.has(name));
    expect(missing, `add these to packages/web/src/api/types.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it.each([...core.keys()])('%s has the same field names on both sides', (name) => {
    const expected = core.get(name) as Set<string>;
    const actual = mirror.get(name);
    expect(actual, `${name} is missing from the mirror`).toBeDefined();
    expect([...(actual as Set<string>)].sort()).toEqual([...expected].sort());
  });
});
