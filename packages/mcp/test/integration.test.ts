import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { NOOP_LOGGER } from '@ce/core';
import { createMcpServer } from '../src/server.js';
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
    // Payload honesty: the engine's own verdict travels with the code.
    expect(['full', 'stubbed', 'code-only']).toContain(portable.renderability);
    expect(portable.usage).toContain(portable.name);

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
    // The customized files are the portable bundle, not the preview harness.
    expect(JSON.stringify(customized.files)).not.toContain('createRoot');
  }, 30000);

  it('serves a compact, paged list_components over a real MCP client', async () => {
    const server = createMcpServer({ cache: new SessionCache(WS), defaultProject: FIXTURE });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: 'list_components', arguments: { limit: 1 } });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    // Pretty-printing is ~35% of the bytes of these payloads and buys nothing.
    expect(text).not.toContain('\n  ');

    const payload = JSON.parse(text) as {
      scanned: number;
      total: number;
      returned: number;
      truncated: boolean;
      nextOffset?: number;
      components: { id: string }[];
    };
    expect(payload.returned).toBe(1);
    expect(payload.total).toBe(payload.scanned);
    expect(payload.components).toHaveLength(1);
    if (payload.total > 1) {
      expect(payload.truncated).toBe(true);
      expect(payload.nextOffset).toBe(1);
    }

    await client.close();
    await server.close();
  }, 30000);
});
