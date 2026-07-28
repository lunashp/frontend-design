import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

/**
 * The pipeline surfaces statically-mined `derived` theme tokens on the artifact
 * token model WITHOUT disturbing the extracted CSS tokens, and discloses what
 * could not be resolved. A plain-CSS target (no createTheme) is left untouched.
 */

const MUI_FIXTURE = path.resolve(import.meta.dirname, '../fixtures/mui-theme');
const CSS_FIXTURE = path.resolve(import.meta.dirname, '../fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-theme-mining-ws');

async function componentId(session: EngineSession, name: string): Promise<string> {
  const scan = await session.scan();
  const found = scan.components.find((c) => c.descriptor.name === name);
  if (!found) throw new Error(`component ${name} not found`);
  return found.descriptor.id;
}

describe('pipeline surfaces mined theme tokens', () => {
  let muiSession: EngineSession;
  let cssSession: EngineSession;

  beforeAll(async () => {
    muiSession = await EngineSession.create({ rootPath: MUI_FIXTURE }, { workspaceRoot: WS });
    cssSession = await EngineSession.create({ rootPath: CSS_FIXTURE }, { workspaceRoot: WS });
  });

  afterAll(async () => {
    await fs.rm(WS, { recursive: true, force: true });
  });

  it('attaches derived tokens + a themes preset map from a TS theme', async () => {
    const id = await componentId(muiSession, 'Panel');
    const { tokenModel } = muiSession.buildArtifact(id);

    const derived = tokenModel.tokens.filter((t) => t.source === 'derived');
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.some((t) => t.displayName === 'palette.primary.main')).toBe(true);

    // Presets from colorSchemes.light / .dark.
    expect(tokenModel.themes).toBeDefined();
    expect(Object.keys(tokenModel.themes!).sort()).toEqual(['dark', 'light']);
  });

  it('discloses the mined theme file and unresolved values', async () => {
    const id = await componentId(muiSession, 'Panel');
    const { tokenModel } = muiSession.buildArtifact(id);

    expect(tokenModel.derivedFrom).toBeDefined();
    const d = tokenModel.derivedFrom!;
    expect(d.exportName).toBe('appTheme');
    expect(d.file.endsWith('config/theme.ts')).toBe(true);
    expect(d.resolved).toBe(15);
    expect(d.unresolved).toBe(2);
    expect(d.unresolvedPaths).toContain('palette.primary.dark');
  });

  it('leaves a plain-CSS target untouched: no derived tokens, no presets', async () => {
    const id = await componentId(cssSession, 'Button');
    const { tokenModel } = cssSession.buildArtifact(id);

    expect(tokenModel.tokens.every((t) => t.source === 'extracted')).toBe(true);
    expect(tokenModel.themes).toBeUndefined();
    expect(tokenModel.derivedFrom).toBeUndefined();
  });
});
