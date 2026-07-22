/**
 * Host entry point. Usage:
 *   tsx src/main.ts --project ../backoffice-frontend --port 4317
 * The `--project` becomes the default target the web gallery scans, and the
 * built gallery (packages/web/dist) is served from the same port, so this is
 * the single command that runs the product.
 */

import * as path from 'node:path';
import { createHost, DEFAULT_HOST } from './server.js';

interface Args {
  project?: string;
  port: number;
  workspaceRoot?: string;
  host: string;
  webRoot?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { port: 4317, host: DEFAULT_HOST };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--project' || arg === '-p') && argv[i + 1]) {
      args.project = path.resolve(argv[++i] as string);
    } else if (arg === '--port' && argv[i + 1]) {
      args.port = Number(argv[++i]);
    } else if (arg === '--workspace' && argv[i + 1]) {
      args.workspaceRoot = path.resolve(argv[++i] as string);
    } else if (arg === '--web-root' && argv[i + 1]) {
      args.webRoot = path.resolve(argv[++i] as string);
    } else if (arg === '--host' && argv[i + 1]) {
      args.host = argv[++i] as string;
    } else if (!arg?.startsWith('-') && arg) {
      args.project = path.resolve(arg);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const host = createHost({
    port: args.port,
    defaultProject: args.project,
    workspaceRoot: args.workspaceRoot ?? path.join(process.cwd(), '.workspace'),
    host: args.host,
    webRoot: args.webRoot,
  });
  const port = await host.listen();
  if (args.host !== DEFAULT_HOST) {
    // The host serves file contents read from anywhere on this machine, so a
    // non-loopback bind exposes the user's source to their whole network.
    console.warn(
      `[ce:host] WARNING: bound to ${args.host}, not ${DEFAULT_HOST} — this exposes local source to the network`,
    );
  }
  console.log(`[ce:host] listening on http://${args.host}:${port}`);
  if (port !== args.port) console.log(`[ce:host] port ${args.port} was taken; using ${port}`);
  if (args.project) console.log(`[ce:host] default project: ${args.project}`);

  const shutdown = () => {
    void host.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
