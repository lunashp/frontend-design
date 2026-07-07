import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';
import type { ComponentArtifact } from '../../src/types/artifact.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-artifact-ws');

let session: EngineSession;
const byName = new Map<string, string>();

beforeAll(async () => {
  session = await EngineSession.create({ rootPath: FIXTURE }, { workspaceRoot: WS });
  for (const c of session.scan().components) byName.set(c.descriptor.name, c.descriptor.id);
});

afterAll(async () => {
  await fs.rm(WS, { recursive: true, force: true });
});

function build(name: string): ComponentArtifact {
  return session.buildArtifact(byName.get(name) as string);
}

describe('buildArtifact — portable bundle', () => {
  it('extracts a self-contained bundle for a css-modules atom (namespaced under /src)', () => {
    const art = build('Button');
    const paths = Object.keys(art.bundle.files);
    expect(paths).toContain('/src/Button.tsx');
    expect(paths).toContain('/src/Button.module.css');
    expect(art.bundle.entryPath).toBe('/src/Button.tsx');
    expect(art.bundle.incomplete).toBeFalsy();
    // External deps: clsx kept with version; react provided by the template.
    expect(art.bundle.externalDeps.clsx).toBe('^2.1.1');
    expect(art.bundle.externalDeps.react).toBeUndefined();
  });

  it('tokenizes the CSS module into re-themeable var() references + tokens.css', () => {
    const art = build('Button');
    // Tokens extracted from Button.module.css (colors + radius + font-size).
    expect(art.tokenModel.tokens.length).toBeGreaterThan(0);
    expect(art.tokenModel.tokens.some((t) => t.category === 'color')).toBe(true);
    // The component CSS now references tokens with literal fallbacks.
    const css = art.bundle.files['/src/Button.module.css'] as string;
    expect(css).toMatch(/var\(--color-1, #3b82f6\)/);
    // tokens.css is part of the copyable bundle.
    const tokensCss = art.bundle.files['/tokens.css'] as string;
    expect(tokensCss).toContain(':root');
    expect(tokensCss).toContain('--color-1: #3b82f6;');
  });

  it('inlines local deps and rewrites alias imports to relative paths', () => {
    const art = build('Card');
    const paths = Object.keys(art.bundle.files);
    expect(paths).toContain('/src/Card/Card.tsx');
    expect(paths).toContain('/src/Button/Button.tsx');
    expect(paths).toContain('/src/Badge/Badge.tsx');
    expect(paths).toContain('/src/Button/Button.module.css');

    const cardSrc = art.bundle.files['/src/Card/Card.tsx'] as string;
    expect(cardSrc).not.toContain("from '@/"); // alias import specifiers rewritten away
    expect(cardSrc).toContain("from '../Button/Button'");
    expect(cardSrc).toContain("from '../Badge/Badge'");
  });

  it('handles a folder/index.tsx component without colliding with the entry, and inlines a .js sibling', () => {
    const art = build('Chip');
    const paths = Object.keys(art.bundle.files);
    // Component lives under /src so it never collides with the reserved /index.tsx entry.
    expect(paths).toContain('/src/components/Chip/index.tsx');
    expect(art.bundle.entryPath).toBe('/src/components/Chip/index.tsx');
    // The local .js util is inlined (not dropped) and its alias import rewritten.
    expect(paths).toContain('/src/utils/format.js');
    expect(art.bundle.incomplete).toBeFalsy();
    // The generated entry and the index.tsx component coexist as distinct files.
    expect(art.sandpack.files['/index.tsx']).toBeDefined();
    expect(art.sandpack.files['/src/components/Chip/index.tsx']).toBeDefined();
    expect(art.sandpack.renderability).toBe('full');
    const entry = art.sandpack.files['/index.tsx'] as string;
    expect(entry).toContain("from './src/components/Chip/index'");
    expect(entry).toContain('__Component');
  });
});

describe('buildArtifact — sandpack spec', () => {
  it('marks a zero-context presentational atom as fully renderable', () => {
    const art = build('Button');
    expect(art.sandpack.template).toBe('react-ts');
    expect(art.sandpack.renderability).toBe('full');
    expect(art.sandpack.entryPath).toBe('/index.tsx');
    const entry = art.sandpack.files['/index.tsx'] as string;
    expect(entry).toContain('Button');
    expect(entry).toContain('createRoot');
    expect(art.sandpack.files['/tokens.css']).toBeDefined();
  });

  it('marks a context-consuming component as stubbed', () => {
    const art = build('UserPanel');
    expect(art.sandpack.renderability).toBe('stubbed');
    expect(art.sandpack.notes.join(' ')).toMatch(/context/i);
  });

  it('generates sample props that mount the component', () => {
    const art = build('Badge');
    const entry = art.sandpack.files['/index.tsx'] as string;
    // Badge has a required `children` node prop -> filled with the component name.
    expect(entry).toContain('"children": "Badge"');
  });
});
