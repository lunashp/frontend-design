import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
import { SessionCache } from '../src/session-cache.js';

const EXPECTED_TOOLS = [
  'customize_component',
  'get_portable_code',
  'list_components',
  'scan_project',
];

describe('createMcpServer', () => {
  it('registers exactly the four P5 tools', async () => {
    const server = createMcpServer({ cache: new SessionCache() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);

    await client.close();
    await server.close();
  });

  it('returns a tool error (not a throw) when no project path is available', async () => {
    const server = createMcpServer({ cache: new SessionCache() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: 'scan_project', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.text).toContain('[MISSING_PATH]');

    await client.close();
    await server.close();
  });
});
