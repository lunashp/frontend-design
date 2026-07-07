/**
 * @ce/mcp — MCP server wrapping @ce/core for agent-driven scan/port/customize.
 * Placeholder until P5; the engine is already transport-agnostic, so this will
 * be a thin adapter (scan_project / list_components / get_portable_code /
 * customize_component) over the same EngineSession the web host uses.
 */

export const MCP_PLACEHOLDER = 'P5' as const;

function main(): void {
  console.error('[ce:mcp] Not implemented yet (P5). The engine (@ce/core) is ready to wrap.');
  process.exitCode = 1;
}

main();
