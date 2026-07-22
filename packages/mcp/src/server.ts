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
import {
  createLogger,
  DESIGN_STATES,
  EngineError,
  type CustomizationState,
  type Logger,
} from '@ce/core';
import { SessionCache } from './session-cache.js';
import {
  DEFAULT_LIST_LIMIT,
  DESIGN_FIELD_IDS,
  toComponentList,
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

/**
 * A success result: one JSON text block. Deliberately NOT pretty-printed —
 * measured on a 1133-component list, indentation alone was ~25% of the bytes
 * (512KB → 376KB), and these payloads are read by a model with a context budget,
 * not by a human tailing a log.
 */
function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

/**
 * Server-level guidance, surfaced to the client before any tool is called. This
 * is the one part that helps non-Claude clients too, so it states the invariant,
 * the call order, and the budget levers rather than restating each schema.
 */
const INSTRUCTIONS = `Component Explorer turns a local React + TypeScript project into a design source.

READ-ONLY INVARIANT: the target project is never written to and its dev server is never run.
Every tool here only reads. To land code in a destination repo, use your own file-writing tools.

CALL ORDER
1. scan_project — run first. Discovers and classifies every component; the result is cached, so
   later calls are fast. On a large project (1000+ components) the first scan can take minutes;
   supply a progress token and reset your timeout on progress.
2. list_components — filter down to candidates. Each row's \`id\` is the handle for the next two.
3. get_portable_code — one component's copy-ready bundle, prop contract, and usage snippet.
4. customize_component — re-theme tokens, set props, apply design overrides.

RENDERABILITY (on get_portable_code) is the engine's verdict on whether the component can render in
isolation, decided WITHOUT rendering it:
  full      — renders with (near) zero stubs.
  stubbed   — renders, but app context was faked; it may look or behave off.
  code-only — cannot render live (e.g. deps that cannot be loaded); treat the code as reference.

WHAT IS NOT THE COMPONENT: \`sourceAppFiles\` lists bundle files that came from the SOURCE app —
its theme, i18n catalogue, and context providers. They are included so a preview is faithful.
Copying them into a destination app imports the source app's design decisions wholesale, which is
the wrong outcome when the instruction was "match OUR theme". \`stubbedModules\` lists modules
swapped for local stubs and the capability each swap gives up.

BUDGET: list_components returns ${DEFAULT_LIST_LIMIT} rows by default and reports
{ scanned, total, offset, returned, nextOffset, truncated }. Narrow with nameIncludes /
pathIncludes / propIncludes / atomicLevel / kind / maxContextDependencyScore rather than paging;
raise \`limit\` or advance \`offset\` only when you genuinely need more. Nothing is ever truncated
without a flag saying so.`;

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

  const server = new McpServer({ name: 'ce-mcp', version: '0.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'scan_project',
    {
      title: 'Scan project',
      description:
        'Scan a React+TS project (read-only): discover and classify its components. Returns compact stats — counts by atomic level and kind, plus `failures[]` naming every component that could not be analysed. Also returns `heuristicWarnings[]` (never truncated): scan-LEVEL findings where a classification signal (usesStore / usesRouter / usesDataFetching) matched 0 of N components while the project declares a library that exists to be detected — meaning either nothing uses it, or that signal is under-reporting and the derived contextDependencyScore is too low across the board. Run this first; the other tools reuse the cached scan. On a large project the first scan can take minutes and emits progress notifications.',
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
        'List the scanned components, optionally filtered. Scans first if needed. Filters are AND-combined; nameIncludes, pathIncludes and propIncludes are separate so "buttons under src/ui" is expressible. Returns { scanned, total, offset, returned, nextOffset, truncated, components[] } — each row carries the opaque `id` used by get_portable_code and customize_component, plus its prop names. ' +
        `Returns at most ${DEFAULT_LIST_LIMIT} rows unless \`limit\` says otherwise; prefer narrowing the filter over paging.`,
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
        pathIncludes: z
          .string()
          .optional()
          .describe('Case-insensitive substring match on the source file path, e.g. "src/ui"'),
        propIncludes: z
          .string()
          .optional()
          .describe('Keep only components with a prop whose name contains this substring'),
        maxContextDependencyScore: z
          .number()
          .optional()
          .describe('Keep only components at/below this context-dependency score (0 = most isolable)'),
        offset: z.number().int().min(0).optional().describe('Rows to skip; pass back the `nextOffset` of the previous call'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`Cap the number of rows returned (default ${DEFAULT_LIST_LIMIT})`),
      },
    },
    async (args, extra) => {
      try {
        const result = await cache.scan(resolveProject(args.projectPath), callLogger(extra));
        return ok(
          toComponentList(
            result.components,
            {
              atomicLevel: args.atomicLevel,
              kind: args.kind,
              nameIncludes: args.nameIncludes,
              pathIncludes: args.pathIncludes,
              propIncludes: args.propIncludes,
              maxContextDependencyScore: args.maxContextDependencyScore,
            },
            { offset: args.offset, limit: args.limit },
          ),
        );
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
        "Extract one component's copy-ready portable bundle: `files` (incl. /tokens.css), `externalDeps`, the re-themeable `tokens[]` (their ids feed customize_component), the `props[]` contract (their names feed customize_component's propValues), `sampleProps` and a paste-ready `usage` snippet. Also reports what the engine already knows without rendering: `renderability` (full | stubbed | code-only) with `renderNotes`, `stubbedModules` (modules swapped for stubs, and the capability each swap loses), `danglingImports`, and `sourceAppFiles` — bundle files that belong to the SOURCE app's theme / i18n / providers, not to the component. Do not copy sourceAppFiles into a destination app that has its own theme.",
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
        "Re-theme and restyle one component. Returns the re-themed `tokensCss`, the PORTABLE `files` with that stylesheet swapped in (not the preview harness), `designDeclarations` (the RESTING-state CSS declarations, safe to paste inline), `designBlocks` (one entry per state — { state: rest|hover|focus|active, selector, declarations }) and a copyable `designCss` stylesheet built from those blocks. The selectors are an explicit placeholder — a component's real root class cannot be known from outside (CSS-module hashes, library-generated classes) — so replace it, or apply designDeclarations inline and the state blocks as real rules. Every override channel is validated and reported back: `unknownTokenIds`, `unknownPropNames` (with `knownPropNames`), `unknownDesignFields`.",
      inputSchema: {
        projectPath: z.string().optional().describe('Target project root; falls back to launch default'),
        componentId: z.string().describe('Component id from list_components'),
        tokenOverrides: z
          .record(z.string(), z.string())
          .optional()
          .describe('tokenId -> new value (ids from get_portable_code tokens[]); unknown ids come back in unknownTokenIds'),
        propValues: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'propName -> value, merged into the mounted instance. Names come from get_portable_code props[]; unrecognised ones come back in unknownPropNames',
          ),
        designOverrides: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            `Universal design overrides applied to the component root. The ${DESIGN_FIELD_IDS.length} legal fields are: ${DESIGN_FIELD_IDS.join(', ')}. Numeric fields take a bare number (padding/fontSize/radius/borderWidth in px, scale/opacity in %); shadow takes none|sm|md|lg|xl or raw CSS. A bare key styles the resting state; prefix it with "${DESIGN_STATES.join('|')}" and a colon to style an interactive state — e.g. "hover:background", "focus:borderColor", "active:scale" (focus maps to :focus-visible). Anything else comes back in unknownDesignFields`,
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
