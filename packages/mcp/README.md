# component-explorer-mcp

An [MCP](https://modelcontextprotocol.io) server that turns any local **React + TypeScript**
project into an agent-drivable design source. Point it at a project and an AI agent can:

- **scan & classify** every component (atomic level, kind, context-dependency),
- **list & filter** them,
- **extract portable code** for a single component (a copy-ready file bundle + `tokens.css` + external deps),
- **customize** a component — re-theme its design tokens, set prop values, and apply universal design overrides — and get back copy-ready CSS.

It reads the target project **strictly read-only**; it never writes to the project it scans.

## Requirements

- Node.js >= 20.11
- A local React + TypeScript project to point it at.

## Usage

Runs over stdio, so any MCP client can launch it with `npx`. No global install needed.

### Claude Code

```bash
claude mcp add component-explorer -- npx -y component-explorer-mcp
```

### `.mcp.json` (project or client config)

```jsonc
{
  "mcpServers": {
    "component-explorer": {
      "command": "npx",
      "args": ["-y", "component-explorer-mcp"]
    }
  }
}
```

Then call the tools with an absolute `projectPath` to the project you want to inspect. A server
instance is stateless per call, so one server serves any number of projects.

## Tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `scan_project` | `projectPath?`, `force?` | framework, component count, counts by atomic level / kind, warnings. Run first; the result is cached so later calls are fast. |
| `list_components` | `projectPath?`, `atomicLevel?`, `kind?`, `nameIncludes?`, `maxContextDependencyScore?`, `limit?` | filtered rows; each row's `id` is the handle for the next two tools. |
| `get_portable_code` | `projectPath?`, `componentId` | `files` (incl. `/tokens.css`), `externalDeps`, and re-themeable `tokens[]`. |
| `customize_component` | `projectPath?`, `componentId`, `tokenOverrides?`, `propValues?`, `designOverrides?` | a re-themed `tokens.css`, a copyable design-override CSS rule, and the customized files. `tokenOverrides` are keyed by token id (from `get_portable_code` → `tokens[]`); unknown ids are reported back. |

`projectPath` is an absolute path and may be omitted if `CE_DEFAULT_PROJECT` is set.

## Environment variables

| Var | Purpose |
|-----|---------|
| `CE_DEFAULT_PROJECT` | Absolute path used when a tool call omits `projectPath`. |
| `CE_WORKSPACE` | Scratch directory the engine may write to (defaults to `.workspace` in the current directory). The target project is never written to. |

You can also pass `--project <path>` / `--workspace <path>` as CLI args.

## Notes

- **Local by design.** Because it reads a project from the local filesystem, the server runs on
  the same machine as your project — it is not a hosted service.
- **Large projects.** The first `scan_project` on a big project can take a while; the server
  streams MCP progress notifications so timeout-aware clients keep the request alive, and the
  scan is cached afterward. All logging goes to stderr (stdout is reserved for JSON-RPC).
- **Stdio only** in this release.

## License

MIT
