import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NOOP_LOGGER } from '@ce/core';
import { SessionCache } from '../src/session-cache.js';
import { toComponentRows, toCustomized, toPortableCode } from '../src/tools.js';

const FIXTURE = path.resolve(import.meta.dirname, '../../core/test/fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-mcp-ws');

afterAll(async () => {
  await fs.rm(WS, { recursive: true, force: true });
});

describe('@ce/mcp against the simple-react fixture', () => {
  it('scans, lists, extracts portable code, and customizes', async () => {
    const cache = new SessionCache(WS);

    const scan = await cache.scan(FIXTURE, NOOP_LOGGER);
    expect(scan.components.length).toBeGreaterThan(0);

    const rows = toComponentRows(scan.components);
    const button = rows.find((r) => r.name === 'Button') ?? rows[0];
    expect(button?.id).toBeTruthy();

    const artifact = await cache.getArtifact(FIXTURE, button!.id, NOOP_LOGGER);
    const portable = toPortableCode(artifact);
    expect(portable.tokensCssPath).toBe('/tokens.css');
    expect(Object.keys(portable.files)).toContain('/tokens.css');

    const firstToken = portable.tokens[0];
    const tokenOverrides = firstToken ? { [firstToken.id]: '#ff0000' } : {};
    const customized = toCustomized(artifact, {
      tokenOverrides,
      propValues: {},
      designOverrides: { radius: '12' },
    });
    if (firstToken) {
      expect(customized.tokensCss).toContain('#ff0000');
      expect(customized.unknownTokenIds).toEqual([]);
    }
    expect(customized.designCss).toContain('border-radius: 12px;');
  }, 30000);
});
