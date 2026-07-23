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

/** Connect a client to a fresh in-memory server; the caller closes both. */
async function connect(cache = new SessionCache()) {
  const server = createMcpServer({ cache });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('createMcpServer', () => {
  it('registers exactly the four P5 tools', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);

    await close();
  });

  it('publishes instructions covering the invariant, call order and budget levers', async () => {
    const { client, close } = await connect();

    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('READ-ONLY');
    expect(instructions).toContain('scan_project');
    // Renderability values an agent has to interpret.
    expect(instructions).toContain('code-only');
    expect(instructions).toContain('stubbed');
    // Budget levers.
    expect(instructions).toContain('nextOffset');
    expect(instructions).toContain('pathIncludes');

    await close();
  });

  it('says what heuristicWarnings is on the scan_project description', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const scan = tools.find((t) => t.name === 'scan_project');
    const described = String(scan?.description ?? '');
    // A payload field nobody explains is a field nobody acts on: this one says
    // a classification signal may be under-reporting, which changes how much an
    // agent should trust `list_components`' contextDependencyScore filtering.
    expect(described).toContain('heuristicWarnings');

    await close();
  });

  it('advertises the paging and search arguments on list_components', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const list = tools.find((t) => t.name === 'list_components');
    const keys = Object.keys((list?.inputSchema.properties ?? {}) as Record<string, unknown>);
    expect(keys).toEqual(expect.arrayContaining(['pathIncludes', 'propIncludes', 'offset', 'limit']));

    await close();
  });

  it('enumerates every legal design-override field in the customize description', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const customize = tools.find((t) => t.name === 'customize_component');
    const described = String(
      (customize?.inputSchema.properties as Record<string, { description?: string }> | undefined)
        ?.designOverrides?.description ?? '',
    );
    // The docs used to name 6 of the 13 fields; the omitted ones must be listed.
    for (const field of ['scale', 'width', 'fontWeight', 'fontFamily', 'borderWidth', 'borderColor', 'opacity']) {
      expect(described).toContain(field);
    }

    await close();
  });

  it('documents the interactive-state prefixes on the customize description', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const customize = tools.find((t) => t.name === 'customize_component');
    const described = String(
      (customize?.inputSchema.properties as Record<string, { description?: string }> | undefined)
        ?.designOverrides?.description ?? '',
    );
    // A capability nobody is told about is unreachable: the engine has accepted
    // `hover:` / `focus:` / `active:` prefixes all along.
    expect(described).toContain('hover:background');
    for (const state of ['hover', 'focus', 'active']) {
      expect(described).toContain(state);
    }

    await close();
  });

  it('documents the token usages + source on get_portable_code (#4)', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const get = tools.find((t) => t.name === 'get_portable_code');
    const described = String(get?.description ?? '');
    // A field nobody explains is a field nobody acts on: the rows now carry where
    // a token is used and are pre-sorted by that, which drives re-theme priority.
    for (const field of ['source', 'usageCount', 'usages', 'usagesTruncated']) {
      expect(described).toContain(field);
    }

    await close();
  });

  it('documents the scoreBreakdown + hook/context names on list_components (#9)', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const list = tools.find((t) => t.name === 'list_components');
    const described = String(list?.description ?? '');
    for (const field of ['scoreBreakdown', 'hooks', 'contextConsumers']) {
      expect(described).toContain(field);
    }

    await close();
  });

  it('documents invalidDesignValues + value bounds on customize_component (#5)', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const customize = tools.find((t) => t.name === 'customize_component');
    const described = String(customize?.description ?? '');
    // The docs must say values are bounded, not only that keys are checked.
    expect(described).toContain('invalidDesignValues');
    expect(described).toContain('clamped');

    await close();
  });

  it('returns a tool error (not a throw) when no project path is available', async () => {
    const { client, close } = await connect();

    const result = await client.callTool({ name: 'scan_project', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.text).toContain('[MISSING_PATH]');

    await close();
  });
});
