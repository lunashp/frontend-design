/**
 * The shapes that a real target broke on, pinned as a fixture.
 *
 * A census of all 1,133 components in a real MUI app found that only 75% actually
 * showed a design, while the unit suite was fully green — every cause lived
 * between "the function returns the right value" and "the component looks right".
 * Nothing in this repo reproduced any of those shapes, so nothing could catch a
 * regression without that external project.
 *
 * These tests build real artifacts from `fixtures/hard-shapes` and assert on the
 * generated preview entry, so the four shapes are guarded in the node gate — no
 * browser, no external target.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/hard-shapes');
const WS = path.join(os.tmpdir(), 'ce-hard-shapes-ws');

let session: EngineSession;
/** Component name → the generated preview entry source. */
const entries = new Map<string, string>();

beforeAll(async () => {
  session = await EngineSession.create({ rootPath: FIXTURE }, { workspaceRoot: WS });
  const scan = await session.scan();
  for (const c of scan.components) {
    const artifact = session.buildArtifact(c.descriptor.id);
    entries.set(c.descriptor.name, artifact.sandpack.files[artifact.sandpack.entryPath] as string);
  }
});

afterAll(async () => {
  await fs.rm(WS, { recursive: true, force: true });
});

function entry(name: string): string {
  const e = entries.get(name);
  if (!e) throw new Error(`no entry for ${name} — scanned: ${[...entries.keys()].join(', ')}`);
  return e;
}

describe('a visibility-gated overlay', () => {
  it('is mounted OPEN, so the preview is the dialog and not an empty frame', () => {
    expect(entry('GatedDialog')).toMatch(/"?open"?:\s*true/);
  });
});

describe('a component with adornment slots', () => {
  it('leaves the icon slots empty — a word in a 20x20 box overlaps the label', () => {
    const e = entry('SlottedButton');
    expect(e).not.toMatch(/startIcon/);
    expect(e).not.toMatch(/endIcon/);
    expect(e).not.toMatch(/loadingIndicator/);
  });

  it('names children after the component and every other slot after itself', () => {
    const e = entry('SlottedButton');
    expect(e).toMatch(/"?children"?:\s*"SlottedButton"/);
    expect(e).toMatch(/"?helperText"?:\s*"Helper Text"/);
    // The bug this replaces: the component's own name in every slot at once.
    // Scoped to the mounted props — the entry also names the module export.
    const propsBlock = (e.match(/const props = \{[\s\S]*?\n\};/) ?? [''])[0];
    expect(propsBlock.match(/"SlottedButton"/g) ?? []).toHaveLength(1);
  });
});

describe('a component whose only content IS an adornment', () => {
  it('gets a glyph rather than an empty frame', () => {
    expect(entry('IconOnly')).toMatch(/"?icon"?:\s*"●"/);
  });
});

describe('a component reading a custom top-level theme section', () => {
  it('carries the app theme extensions across the preview rebuild', () => {
    const e = entry('ThemedCard');
    // The rebuild keeps MUI's own sections…
    expect(e).toMatch(/cssVariables:\s*true/);
    // …and copies everything else the app put on its theme (customShadows).
    expect(e).toMatch(/if \(!\(__k in __built\)\) __built\[__k\]/);
    // …with a guard so a section that is still missing degrades, never throws.
    expect(e).toMatch(/__guardTop\(__built\)/);
  });
});

// react-docgen-typescript drops a `children` that carries no JSDoc. Measured on
// the real target: 68 components declare `children`, and 52 of them (76%) lost it
// — so the preview had no content to put in them and they rendered empty boxes.
describe('an undocumented children prop', () => {
  it('survives into the prop model, and the preview fills it', () => {
    const e = entry('SlottedButton');
    expect(e).toMatch(/"?children"?:\s*"SlottedButton"/);
  });

  it('is recovered for a component that declares nothing else fillable', () => {
    expect(entry('ThemedCard')).toMatch(/"?children"?:\s*"ThemedCard"/);
  });
});

// `title` is an HTML global attribute AND one of the most common real design
// props (a dialog's, a card's, a section's). 89 components on the real target
// declared one and the DOM-noise filter removed every one.
describe('a title prop', () => {
  it('is kept — it overlaps a real API, like color/size/value already do', () => {
    expect(entry('GatedDialog')).toMatch(/"?title"?:\s*"Title"/);
  });
});

describe('a component that maps a required array', () => {
  it('gets [] so .map is safe, and no invented rows', () => {
    const e = entry('RowTable');
    expect(e).toMatch(/"?rows"?:\s*\[\s*\]/);
  });
});
