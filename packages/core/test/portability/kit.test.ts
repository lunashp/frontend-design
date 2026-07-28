import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Project } from 'ts-morph';
import { EngineSession } from '../../src/pipeline/session.js';
import { resolveMany } from '../../src/portability/resolve-many.js';
import { tokenizeBundle } from '../../src/tokenize/tokenization-transform.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-kit-ws');

/** Reach the ts-morph project the same way the session does, for equivalence checks. */
function tsProjectOf(session: EngineSession): Project {
  const p = (session.program.handle as { tsProject?: Project }).tsProject;
  if (!p) throw new Error('no ts project');
  return p;
}

describe('resolveMany / buildKit — one shared namespace over a set (simple-react)', () => {
  let session: EngineSession;
  const byName = new Map<string, string>();

  beforeAll(async () => {
    session = await EngineSession.create({ rootPath: FIXTURE }, { workspaceRoot: WS });
    const scan = await session.scan();
    for (const c of scan.components) byName.set(c.descriptor.name, c.descriptor.id);
  });

  afterAll(async () => {
    await fs.rm(WS, { recursive: true, force: true });
  });

  it('emits a file shared by two components exactly once, at a stable path', () => {
    const cardId = byName.get('Card') as string;
    const userPanelId = byName.get('UserPanel') as string;
    // UserPanel composes Card, which composes Button — so Button.tsx is reached
    // by both entries. Manual assembly would duplicate (or path-collide) it; the
    // kit must carry it once.
    const kit = session.buildKit([cardId, userPanelId]);

    const buttonFiles = Object.keys(kit.files).filter((k) => /\/Button\/Button\.tsx$/.test(k));
    expect(buttonFiles).toHaveLength(1);

    // Both components are addressable, in input order, each with a real entry.
    expect(kit.components.map((c) => c.id)).toEqual([cardId, userPanelId]);
    expect(kit.entryPaths[cardId]).toBe(kit.components[0]!.entryPath);
    expect(kit.entryPaths[userPanelId]).toBe(kit.components[1]!.entryPath);
    expect(kit.files[kit.entryPaths[cardId] as string]).toBeDefined();
    expect(kit.tokensCssPath).toBe('/tokens.css');
    expect(kit.files['/tokens.css']).toBe(kit.tokensCss);
  });

  it('buildKit reuses the cached scan and returns what resolveMany would', () => {
    const buttonId = byName.get('Button') as string;
    const cardId = byName.get('Card') as string;
    const viaSession = session.buildKit([buttonId, cardId]);
    const direct = resolveMany(
      tsProjectOf(session),
      [session.descriptor(buttonId), session.descriptor(cardId)],
      session.loaded,
    );
    expect(viaSession).toEqual(direct);
  });

  it('memoizes by the id-set (order-independent) and rejects an unknown id', () => {
    const buttonId = byName.get('Button') as string;
    const cardId = byName.get('Card') as string;
    const a = session.buildKit([buttonId, cardId]);
    const b = session.buildKit([cardId, buttonId]);
    expect(b).toBe(a);
    expect(() => session.buildKit(['does#not-exist'])).toThrow();
  });
});

/**
 * The shared token namespace is the whole reason manual assembly corrupts a set:
 * two components each restart their token counters at `--color-1`, so the same
 * value gets clashing names. The kit tokenizes the merged set once, so a value
 * common to two SEPARATE files gets ONE name referenced by both.
 */
describe('resolveMany — shared token namespace across two files', () => {
  const dirs: string[] = [];

  async function write(root: string, rel: string, content: string): Promise<void> {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }

  async function project(): Promise<string> {
    const root = path.join(os.tmpdir(), `ce-kit-tok-${dirs.length}`);
    dirs.push(root);
    await fs.rm(root, { recursive: true, force: true });
    await write(root, 'package.json', JSON.stringify({ name: 'tok', dependencies: { react: '^19.0.0' } }));
    await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx'] }));
    await write(root, 'src/Alpha/Alpha.module.css', `.box { background: #3b82f6; color: #ffffff; }\n`);
    await write(
      root,
      'src/Alpha/Alpha.tsx',
      `import styles from './Alpha.module.css';\nexport const Alpha = () => <div className={styles.box}>A</div>;\n`,
    );
    await write(root, 'src/Beta/Beta.module.css', `.panel { background: #3b82f6; border-radius: 4px; }\n`);
    await write(
      root,
      'src/Beta/Beta.tsx',
      `import styles from './Beta.module.css';\nexport const Beta = () => <div className={styles.panel}>B</div>;\n`,
    );
    return root;
  }

  afterEach(async () => {
    await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
    dirs.length = 0;
    await fs.rm(WS, { recursive: true, force: true });
  });

  it('gives a value used by two components ONE token name, referenced by both', async () => {
    const root = await project();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const alphaId = scan.components.find((c) => c.descriptor.name === 'Alpha')!.descriptor.id;
    const betaId = scan.components.find((c) => c.descriptor.name === 'Beta')!.descriptor.id;

    const kit = session.buildKit([alphaId, betaId]);
    const cssKeys = Object.keys(kit.files).filter((k) => k.endsWith('.module.css'));
    const alphaCss = kit.files[cssKeys.find((k) => k.includes('Alpha')) as string] as string;
    const betaCss = kit.files[cssKeys.find((k) => k.includes('Beta')) as string] as string;

    const nameOf = (css: string): string | undefined => css.match(/var\((--color-\d+), #3b82f6\)/)?.[1];
    const a = nameOf(alphaCss);
    const b = nameOf(betaCss);
    expect(a).toBeTruthy();
    // The keystone: the SAME shared token name in two separate files.
    expect(b).toBe(a);
    // ...declared exactly once in the single tokens.css.
    expect((kit.tokensCss.match(/: #3b82f6;/g) ?? []).length).toBe(1);
    expect(kit.tokenModel.tokens.filter((t) => t.value === '#3b82f6')).toHaveLength(1);
  });
});

/**
 * A set can legitimately disagree about a dependency's version — one component
 * imports it directly (no declared range → `latest`), another pulls it in as an
 * installed peer (`^<installed>`). Silently picking one hides the mismatch; the
 * kit records it.
 */
describe('resolveMany — conflicting dependency ranges across a set', () => {
  const dirs: string[] = [];

  async function write(root: string, rel: string, content: string): Promise<void> {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  async function pkg(root: string, name: string, json: Record<string, unknown>): Promise<void> {
    await write(root, path.join('node_modules', name, 'package.json'), JSON.stringify(json));
  }

  async function project(): Promise<string> {
    const root = path.join(os.tmpdir(), `ce-kit-conflict-${dirs.length}`);
    dirs.push(root);
    await fs.rm(root, { recursive: true, force: true });
    // `shared-lib` is deliberately NOT declared here.
    await write(
      root,
      'package.json',
      JSON.stringify({ name: 'conflict', dependencies: { react: '^19.0.0', 'widget-kit': '^2.0.0' } }),
    );
    await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx'] }));
    // Alpha imports shared-lib directly — undeclared, so its range resolves to `latest`.
    await write(
      root,
      'src/Alpha.tsx',
      `import { X } from 'shared-lib';\nexport const Alpha = () => <X />;\n`,
    );
    // Beta imports widget-kit, whose installed peer is shared-lib → `^3.1.0`.
    await write(
      root,
      'src/Beta.tsx',
      `import { Y } from 'widget-kit';\nexport const Beta = () => <Y />;\n`,
    );
    await pkg(root, 'widget-kit', {
      name: 'widget-kit',
      version: '2.0.0',
      peerDependencies: { 'shared-lib': '^3.0.0' },
    });
    await pkg(root, 'shared-lib', { name: 'shared-lib', version: '3.1.0' });
    return root;
  }

  afterEach(async () => {
    await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
    dirs.length = 0;
    await fs.rm(WS, { recursive: true, force: true });
  });

  it('records a depConflicts entry naming each requester and its range', async () => {
    const root = await project();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const alphaId = scan.components.find((c) => c.descriptor.name === 'Alpha')!.descriptor.id;
    const betaId = scan.components.find((c) => c.descriptor.name === 'Beta')!.descriptor.id;

    const kit = session.buildKit([alphaId, betaId]);
    const conflict = kit.depConflicts.find((c) => c.package === 'shared-lib');
    expect(conflict).toBeDefined();
    expect(new Set(conflict!.requirements.map((r) => r.range))).toEqual(new Set(['latest', '^3.1.0']));
    expect(conflict!.requirements.map((r) => r.componentId).sort()).toEqual([alphaId, betaId].sort());
    // The merged install list still carries the package (one range picked).
    expect(kit.externalDeps['shared-lib']).toBeDefined();
  });
});

describe('single-component tokenizeBundle keeps its self-contained naming', () => {
  it('still restarts token names per bundle (--color-1), unchanged by the kit path', () => {
    const r = tokenizeBundle({ '/x.css': '.a { color: #3b82f6; }' });
    expect(r.tokenModel.tokens.map((t) => t.name)).toContain('--color-1');
  });
});
