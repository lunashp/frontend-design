/**
 * Builds the MCP server: registers the four P5 tools over @ce/core's engine and
 * returns it WITHOUT connecting a transport (transport wiring is main.ts's job —
 * the same split as @ce/host's createHost vs main.ts). The engine is already
 * transport-agnostic, so each handler is a thin resolve → cache → shape → return.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createLogger, EngineError, type CustomizationState, type Logger } from '@ce/core';
import { SessionCache } from './session-cache.js';
import {
  filterComponents,
  toComponentRows,
  toCustomized,
  toPortableCode,
  toScanSummary,
  toToolError,
} from './tools.js';

export interface McpServerOptions {
  readonly cache?: SessionCache;
  /** Fallback project when a tool call omits `projectPath`. */
  readonly defaultProject?: string;
  readonly logger?: Logger;
}

/** A success result: one JSON text block. */
function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const cache = options.cache ?? new SessionCache(process.env.CE_WORKSPACE);
  const logger = options.logger ?? createLogger();

  // A scan of a large project can outlast a client's default request timeout.
  // Forward each engine progress event as an MCP progress notification (the
  // stdio analogue of the web host's WebSocket progress stream) so a
  // timeout-aware client keeps the request alive; also log it to the base
  // logger (stderr). Progress is a monotonic counter — clients only require it
  // to increase.
  const callLogger = (extra: ToolExtra): Logger => {
    const token = extra._meta?.progressToken;
    let n = 0;
    return {
      log: (level, message, meta) => logger.log(level, message, meta),
      progress: (event) => {
        logger.progress(event);
        if (token !== undefined) {
          n += 1;
          void extra
            .sendNotification({
              method: 'notifications/progress',
              params: { progressToken: token, progress: n, message: `${event.phase}: ${event.message}` },
            })
            .catch(() => {
              /* a dropped progress ping must never fail the tool call */
            });
        }
      },
    };
  };

  const resolveProject = (projectPath?: string): string => {
    const chosen = projectPath ?? options.defaultProject;
    if (!chosen) {
      throw new EngineError(
        'No projectPath argument and no launch default (--project / CE_DEFAULT_PROJECT)',
        'MISSING_PATH',
      );
    }
    return chosen;
  };

  const server = new McpServer({ name: 'ce-mcp', version: '0.0.0' });

  server.registerTool(
    'scan_project',
    {
      title: 'Scan project',
      description:
        'Scan a React+TS project (read-only): discover and classify its components. Returns compact stats; run this first — the other tools reuse the cached scan.',
      inputSchema: {
        projectPath: z
          .string()
          .optional()
          .describe('Absolute path to the target project root; falls back to the launch default'),
        force: z.boolean().optional().describe('Re-scan even if a result is cached'),
      },
    },
    async (args, extra) => {
      try {
        const result = await cache.scan(resolveProject(args.projectPath), callLogger(extra), {
          force: args.force === true,
        });
        return ok(toScanSummary(result));
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  server.registerTool(
    'list_components',
    {
      title: 'List components',
      description:
        'List the scanned components, optionally filtered. Scans first if needed. Each row includes the opaque `id` used by get_portable_code and customize_component.',
      inputSchema: {
        projectPath: z.string().optional().describe('Target project root; falls back to launch default'),
        atomicLevel: z
          .enum(['atom', 'molecule', 'organism', 'page'])
          .optional()
          .describe('Keep only components at this atomic level'),
        kind: z
          .enum(['presentational', 'container', 'layout'])
          .optional()
          .describe('Keep only components of this kind'),
        nameIncludes: z.string().optional().describe('Case-insensitive substring match on the name'),
        maxContextDependencyScore: z
          .number()
          .optional()
          .describe('Keep only components at/below this context-dependency score (0 = most isolable)'),
        limit: z.number().int().positive().optional().describe('Cap the number of rows returned'),
      },
    },
    async (args, extra) => {
      try {
        const result = await cache.scan(resolveProject(args.projectPath), callLogger(extra));
        const filtered = filterComponents(result.components, {
          atomicLevel: args.atomicLevel,
          kind: args.kind,
          nameIncludes: args.nameIncludes,
          maxContextDependencyScore: args.maxContextDependencyScore,
          limit: args.limit,
        });
        return ok({
          total: result.components.length,
          returned: filtered.length,
          components: toComponentRows(filtered),
        });
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  server.registerTool(
    'get_portable_code',
    {
      title: 'Get portable code',
      description:
        "Extract one component's copy-ready portable bundle: files (incl. /tokens.css), external deps, and the re-themeable tokens[] (their ids feed customize_component).",
      inputSchema: {
        projectPath: z.string().optional().describe('Target project root; falls back to launch default'),
        componentId: z.string().describe('Component id from list_components'),
      },
    },
    async (args, extra) => {
      try {
        const artifact = await cache.getArtifact(
          resolveProject(args.projectPath),
          args.componentId,
          callLogger(extra),
        );
        return ok(toPortableCode(artifact));
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  server.registerTool(
    'customize_component',
    {
      title: 'Customize component',
      description:
        'Re-theme and restyle one component. Returns a re-themed tokens.css, a copyable design-override CSS rule, and the customized files. tokenOverrides are keyed by token id (from get_portable_code tokens[]); unknown ids are reported back.',
      inputSchema: {
        projectPath: z.string().optional().describe('Target project root; falls back to launch default'),
        componentId: z.string().describe('Component id from list_components'),
        tokenOverrides: z
          .record(z.string(), z.string())
          .optional()
          .describe('tokenId -> new value (ids from get_portable_code tokens[])'),
        propValues: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('propName -> value, merged into the mounted instance'),
        designOverrides: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Universal design overrides (e.g. { background, color, radius, padding, fontSize, shadow }) applied to the component root',
          ),
      },
    },
    async (args, extra) => {
      try {
        const artifact = await cache.getArtifact(
          resolveProject(args.projectPath),
          args.componentId,
          callLogger(extra),
        );
        const state: CustomizationState = {
          tokenOverrides: args.tokenOverrides ?? {},
          propValues: args.propValues ?? {},
          designOverrides: args.designOverrides ?? {},
        };
        return ok(toCustomized(artifact, state));
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  return server;
}
