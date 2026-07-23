import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, type McpServerOptions } from '../src/server.js';
import { SessionCache } from '../src/session-cache.js';
import type { A11yAuditor } from '../src/a11y.js';

const EXPECTED_TOOLS = [
  'customize_component',
  'get_accessibility',
  'get_portable_code',
  'get_portable_kit',
  'list_components',
  'scan_project',
];

/** A real multi-component project (UserPanel → Card → Button) to exercise buildKit end to end. */
const FIXTURE = path.resolve(import.meta.dirname, '../../core/test/fixtures/simple-react');

/** Connect a client to a fresh in-memory server; the caller closes both. */
async function connect(
  cache = new SessionCache(),
  defaultProject?: string,
  extra: Omit<McpServerOptions, 'cache' | 'defaultProject'> = {},
) {
  const server = createMcpServer({ cache, defaultProject, ...extra });
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

/** Parse the single JSON text block a successful tool call returns. */
function payload(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('createMcpServer', () => {
  it('registers exactly the engine tools, including the multi-component kit', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);

    await close();
  });

  it('describes get_portable_kit as ONE de-duplicated single-namespace set (#kit)', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const kit = tools.find((t) => t.name === 'get_portable_kit');
    const described = String(kit?.description ?? '');
    // The whole reason the tool exists: stop calling get_portable_code N times and
    // hand-merging colliding token names — the description must say so.
    expect(described).toContain('namespace');
    expect(described).toContain('depConflicts');
    const keys = Object.keys((kit?.inputSchema.properties ?? {}) as Record<string, unknown>);
    expect(keys).toEqual(expect.arrayContaining(['ids']));

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

  it('documents the usedByCount reuse signal, its stories/tests caveat, and the order arg', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const list = tools.find((t) => t.name === 'list_components');
    const keys = Object.keys((list?.inputSchema.properties ?? {}) as Record<string, unknown>);
    // The usage ordering knob must be advertised.
    expect(keys).toContain('order');

    const desc = String(list?.description ?? '');
    expect(desc).toContain('usedByCount');
    // The honesty caveat must travel with the field, not just live in code.
    expect(desc.toLowerCase()).toContain('stories');
    expect(desc).toContain('mostUsed');

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

  it('frames get_accessibility as advisory, from the render, with the stubbed caveat and no-backend honesty', async () => {
    const { client, close } = await connect();

    const { tools } = await client.listTools();
    const a11y = tools.find((t) => t.name === 'get_accessibility');
    const described = String(a11y?.description ?? '');
    // Advisory, not a gate; from the RENDER, not a source scan.
    expect(described.toLowerCase()).toContain('advisory');
    expect(described.toLowerCase()).toContain('render');
    // The stubbed-context caveat and the no-backend honesty must travel with the tool.
    expect(described).toContain('stubbedContext');
    expect(described).toContain('no-render-backend');

    // And the instructions must tell every client the audit is advisory + where it runs.
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('get_accessibility');
    expect(instructions).toContain('no-render-backend');

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

/**
 * End-to-end over the real engine: scan simple-react, then harvest a SET. One
 * cache is scanned once (buildKit reuses it), so every case is fast after the
 * first. The fixture's UserPanel composes Card composes Button, so a two-id kit
 * exercises the de-dup that hand-merging N single bundles would get wrong.
 */
describe('get_portable_kit (integration, simple-react)', () => {
  const WS = path.join(os.tmpdir(), 'ce-mcp-kit-ws');
  const cache = new SessionCache(WS);
  let client: Client;
  let close: () => Promise<void>;
  let cardId: string;
  let userPanelId: string;

  beforeAll(async () => {
    const conn = await connect(cache, FIXTURE);
    client = conn.client;
    close = conn.close;
    const list = await client.callTool({ name: 'list_components', arguments: {} });
    const rows = payload(list).components as { id: string; name: string }[];
    cardId = rows.find((r) => r.name === 'Card')?.id as string;
    userPanelId = rows.find((r) => r.name === 'UserPanel')?.id as string;
    expect(cardId).toBeTruthy();
    expect(userPanelId).toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    await close();
    await fs.rm(WS, { recursive: true, force: true });
  });

  it('merges two components into one folder with a single shared tokens.css', async () => {
    const result = await client.callTool({
      name: 'get_portable_kit',
      arguments: { ids: [cardId, userPanelId] },
    });
    expect(result.isError).toBeFalsy();
    const kit = payload(result);

    const components = kit.components as { id: string }[];
    expect(components.map((c) => c.id)).toEqual([cardId, userPanelId]);

    const files = kit.files as Record<string, string>;
    expect(kit.tokensCssPath).toBe('/tokens.css');
    expect(files['/tokens.css']).toBe(kit.tokensCss);
    // Button is reached by BOTH entries; the kit must carry it exactly once.
    expect(Object.keys(files).filter((k) => /\/Button\/Button\.tsx$/.test(k))).toHaveLength(1);

    const entryPaths = kit.entryPaths as Record<string, string>;
    expect(files[entryPaths[cardId] as string]).toBeDefined();
    expect(files[entryPaths[userPanelId] as string]).toBeDefined();
  });

  it('errors on an empty or non-array ids input at the schema boundary', async () => {
    // The SDK turns an input-schema violation into an isError tool result (with the
    // validation message), the same envelope every other failure here uses.
    const empty = await client.callTool({ name: 'get_portable_kit', arguments: { ids: [] } });
    expect(empty.isError).toBe(true);
    expect((empty.content as { text: string }[])[0]?.text).toContain('Invalid arguments');

    const notArray = await client.callTool({
      name: 'get_portable_kit',
      arguments: { ids: 'nope' } as never,
    });
    expect(notArray.isError).toBe(true);
    expect((notArray.content as { text: string }[])[0]?.text).toContain('Invalid arguments');
  });

  it('returns a clean tool error for an unknown id', async () => {
    const result = await client.callTool({
      name: 'get_portable_kit',
      arguments: { ids: ['does#not-exist'] },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.text).toContain('[COMPONENT_NOT_FOUND]');
  });

  it('get_accessibility degrades to no-render-backend by default (no browser in this package)', async () => {
    const result = await client.callTool({
      name: 'get_accessibility',
      arguments: { componentId: cardId },
    });
    expect(result.isError).toBeFalsy();
    const body = payload(result);
    // The component identity still comes back; the audit itself is unavailable, honestly.
    expect(body.id).toBe(cardId);
    expect(body.available).toBe(false);
    expect(body.reason).toBe('no-render-backend');
    expect(String(body.disclosure).toLowerCase()).toContain('host');
  });

  it('get_accessibility returns the injected auditor report, folded with the component identity', async () => {
    // A deployment that owns a render backend injects the real auditor; here a fake
    // one stands in to prove the tool surfaces its report compactly, with the caveat.
    const auditor: A11yAuditor = async () => ({
      available: true,
      renderability: 'stubbed',
      stubbedContext: true,
      summary: { critical: 1, serious: 0, moderate: 0, minor: 0 },
      total: 1,
      findings: [
        {
          ruleId: 'button-name',
          impact: 'critical',
          help: 'Buttons must have discernible text',
          helpUrl: 'https://example.test/button-name',
          nodeCount: 1,
          targets: ['button'],
        },
      ],
      truncated: false,
      disclosure: 'Advisory — from the rendered preview; stubbed context may add or mask issues.',
    });
    const conn = await connect(cache, FIXTURE, { auditA11y: auditor });
    try {
      const result = await conn.client.callTool({
        name: 'get_accessibility',
        arguments: { componentId: cardId },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const body = JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;
      expect(body.id).toBe(cardId);
      expect(body.available).toBe(true);
      expect(body.stubbedContext).toBe(true);
      const summary = body.summary as { critical: number };
      expect(summary.critical).toBe(1);
      const findings = body.findings as Array<{ ruleId: string }>;
      expect(findings[0]?.ruleId).toBe('button-name');
    } finally {
      await conn.close();
    }
  });
});
