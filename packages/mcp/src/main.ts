/**
 * @ce/mcp entry point — a stdio MCP server wrapping @ce/core. Usage (via an MCP
 * client / .mcp.json):
 *   tsx src/main.ts [--project ../some-frontend] [--workspace .workspace]
 *
 * The engine is transport-agnostic; this file only wires stdio and process
 * lifecycle. CRITICAL: on stdio, stdout is reserved for JSON-RPC — every log
 * MUST go to stderr, so the logger below routes ALL levels (and progress) there.
 * The default createLogger sink writes info/warn to stdout, which would corrupt
 * the protocol.
 */

import * as path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLogger } from '@ce/core';
import { createMcpServer } from './server.js';
import { SessionCache } from './session-cache.js';

interface Args {
  project?: string;
  workspaceRoot?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--project' || arg === '-p') && argv[i + 1]) {
      args.project = path.resolve(argv[++i] as string);
    } else if (arg === '--workspace' && argv[i + 1]) {
      args.workspaceRoot = path.resolve(argv[++i] as string);
    } else if (!arg?.startsWith('-') && arg) {
      args.project = path.resolve(arg);
    }
  }
  return args;
}

// Every level → stderr. Never console.log on a stdio transport.
const logger = createLogger({
  sink: (level, message, meta) => console.error(`[ce:mcp:${level}] ${message}`, meta ?? ''),
  onProgress: (e) => console.error(`[ce:mcp:progress] ${e.phase} ${e.message}`),
});

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot =
    args.workspaceRoot ?? process.env.CE_WORKSPACE ?? path.join(process.cwd(), '.workspace');
  const defaultProject =
    args.project ??
    (process.env.CE_DEFAULT_PROJECT ? path.resolve(process.env.CE_DEFAULT_PROJECT) : undefined);

  const cache = new SessionCache(workspaceRoot);
  const server = createMcpServer({ cache, defaultProject, logger });

  await server.connect(new StdioServerTransport());
  console.error('[ce:mcp] ready on stdio');
  if (defaultProject) console.error(`[ce:mcp] default project: ${defaultProject}`);

  const shutdown = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
