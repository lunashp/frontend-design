/**
 * Host entry point. Usage:
 *   tsx src/main.ts --project ../backoffice-frontend --port 4317
 * The `--project` becomes the default target the web gallery scans.
 */

import * as path from 'node:path';
import { createHost } from './server.js';

interface Args {
  project?: string;
  port: number;
  workspaceRoot?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { port: 4317 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--project' || arg === '-p') && argv[i + 1]) {
      args.project = path.resolve(argv[++i] as string);
    } else if (arg === '--port' && argv[i + 1]) {
      args.port = Number(argv[++i]);
    } else if (arg === '--workspace' && argv[i + 1]) {
      args.workspaceRoot = path.resolve(argv[++i] as string);
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
  });
  const port = await host.listen();
  console.log(`[ce:host] listening on http://localhost:${port}`);
  if (args.project) console.log(`[ce:host] default project: ${args.project}`);

  const shutdown = () => {
    void host.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
