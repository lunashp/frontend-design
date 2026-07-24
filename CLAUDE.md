# component-explorer

Read an existing React+TS project (read-only), classify & visualize its design
components, extract portable code, and re-theme it.

## Stack

- **pnpm@10.25.0** monorepo (Turborepo). Use **pnpm only** — never `npm` or `yarn`.
- Node >= 20.11. TypeScript. Vitest for unit tests. Playwright for browser/E2E.
- Packages: `packages/core`, `packages/host`, `packages/web`, `packages/mcp`.

## UI work: read `packages/web/DESIGN.md` FIRST

Any change to `packages/web` that a user can see — colour, spacing, type, a new
component, a new state — is governed by **`packages/web/DESIGN.md`** ("Moonstone").

It is the **only** design direction for this app, and it overrides generic design
guidance from any other source (personal rulesets, framework defaults, a library's
look, a menu of "style directions"). Those describe options for a project that has
not chosen yet; this one has chosen. Values live in `packages/web/src/styles/tokens.css`
— never hardcode a colour, size, radius or duration in a module.

Two things it will stop you doing, both of which read as machine-generated UI:

- **Coloured left-border "emphasis" rails are banned.** Use the aside surface
  (`--aside-bg` / `--aside-bg-warn` / `--aside-bg-accent`) instead. Structural
  left borders — a panel's own edge, a segmented-control divider — are fine.
- **Never state one fact in two visual channels.** If a chip says it in words,
  a colour must not repeat it.

If a surface genuinely needs a treatment the document does not have, add it to
the document *with its reason* first, then build it.

## Verification gate (MUST pass before declaring work done)

Run these for real and read the output. **Do not claim success without actually
running them** — a passing gate is the loop's exit condition.

```bash
pnpm install      # ensure deps (no-op if node_modules present)
pnpm typecheck    # turbo run typecheck
pnpm lint         # turbo run lint
pnpm test         # vitest run
pnpm build        # turbo run build
```

Every gate command above is **non-interactive** and must never wait for input.
Do NOT put interactive commands (watch mode, bare `vitest`, `pnpm dev`, anything
that prompts) into the gate — they hang a cloud session forever.

## Cloud sessions (Claude Code on the web)

- Dependencies auto-install via the `SessionStart` hook in `.claude/settings.json`
  (runs `pnpm install --frozen-lockfile` + Playwright Chromium only when the cloud
  VM comes up fresh with no `node_modules`).
- **Browser / E2E is excluded from the cloud gate.** Playwright system libraries
  may be missing in the cloud VM. Run browser tests locally or in CI — never make
  them a cloud loop exit condition. (To enable them in the cloud anyway, add
  `pnpm exec playwright install-deps chromium || true` to the environment's
  Setup script field at claude.ai/code — it runs as root.)
- User-level `~/.claude` config (personal rules, skills, agents, `claude mcp add`
  servers) does **NOT** transfer to the cloud VM. Anything a cloud run needs must
  live in this repo: `.claude/`, `.mcp.json`, and this file.

## md-log MCP (work logs, reports, design docs)

Durable markdown — session logs, component-analysis reports, design docs — belongs
in **md-log** (hosted, versioned) via the `md-log` MCP server, not in this repo.

### Config

`.mcp.json` (committed) defines the server. The PAT is **never** committed; it is
read from the `MDLOG_PAT` env var, with `MDLOG_API_BASE_URL` defaulting to
`https://app.md-log.com/api/v1`.

- **Local:** export `MDLOG_PAT` in your shell profile (`~/.zshrc`). MCP scope
  precedence is local > project > user, so this repo's `.mcp.json` entry
  **overrides** any user-scope `claude mcp add md-log` — the PAT stored in the
  user-level config no longer applies here, and without the env var the server
  starts with a literal `${MDLOG_PAT}` and fails to authenticate.
- **Cloud:** set `MDLOG_PAT` in the Environment variables field at claude.ai/code
  (`KEY=value`). It is visible to anyone who can edit that environment.
- A project-scoped MCP server needs a one-time interactive approval on first use,
  so a fresh cloud session may show md-log as `⏸ Pending approval`.

### Path convention

md-log is one workspace shared across every project, so **every document this repo
writes lives under the `component-explorer/` folder** — the root `package.json`
name. Never save to the md-log root.

| Path | Contents |
|------|----------|
| `component-explorer/logs/<YYYY-MM-DD>-<topic>.md` | Session/work logs: what changed, gate results |
| `component-explorer/reports/<YYYY-MM-DD>-<target>.md` | Component scan & classification reports |
| `component-explorer/docs/<topic>.md` | PRD, architecture, design notes |

That folder needs no setup and no existence check: `save_markdown` auto-creates
every missing path segment, and writes into the existing folder when it is already
there. Just save to the full path — "create it if absent, accumulate under it if
present" is the default behaviour, not something to branch on.

### Rules

- `save_markdown` creates or overwrites by path (last-writer-wins; folders are
  auto-created). Use `append_to_markdown` to extend a log and `update_markdown`
  for edits; `get_markdown` / `list_versions` before overwriting someone's work.
- **Do not call `create_folder`.** `save_markdown`, `append_to_markdown` and
  `move_markdown` auto-create their destination folders, so an explicit call is a
  wasted round-trip. It is only for deliberately making an *empty* folder.
- Folder paths take **no** `.md` suffix; file paths **require** one. Paths are
  NFC-normalized, and `..`, `.`, backslashes, control chars, empty segments and
  reserved names are rejected (255-byte name / 1024-byte path limits).
- **Always** pass `commit_message` — a 1–2 line summary of what changed and why.
  It is the version history a human scans.
- Screenshots and diagrams: pass a local `file_path` to `upload_asset` (or to
  `save_markdown`'s `assets`) and embed the returned `![alt](asset://<key>)`.
  Do not commit images to this repo for this purpose.
- Never call `delete_markdown` / `delete_folder` on your own initiative. Both need
  `confirm:true`, and `delete_folder` with `cascade:true` is `rm -r` over a whole
  subtree — only ever on an explicit user request.
- **md-log is NOT part of the verification gate.** The backend is remote and can be
  transiently unreachable, and every tool here is non-interactive but network-bound.
  A failed md-log call never blocks work and never fails the gate — report the
  failure and move on.

## ce-mcp MCP server (agent-facing engine tools) — P5

`@ce/mcp` (`packages/mcp`) wraps the same `EngineSession` as `@ce/host`, exposing the
engine to an agent over stdio. It is the MCP sibling of the web host — a thin adapter,
no engine logic of its own. Four tools:

| Tool | Purpose |
|------|---------|
| `scan_project` | Scan a project (read-only); returns compact stats. Run first; other tools reuse the cached scan. |
| `list_components` | Filtered component rows (by `atomicLevel` / `kind` / `nameIncludes` / `maxContextDependencyScore` / `limit`). Each row's `id` is the handle for the next two tools. |
| `get_portable_code` | One component's copy-ready bundle: `files` (incl. `/tokens.css`), `externalDeps`, and re-themeable `tokens[]`. |
| `customize_component` | Re-theme + restyle: `tokenOverrides` (by token id), `propValues`, `designOverrides`. Returns re-themed `tokens.css`, a copyable design CSS rule, and the customized files. |

### Config & running

- Registered in `.mcp.json` (committed) as `ce-mcp`, launched from the repo root with
  `pnpm -s exec tsx packages/mcp/src/main.ts`. **`-s` (silent) matters:** on stdio,
  **stdout is reserved for JSON-RPC** — pnpm's banner would corrupt the protocol. All
  server logging goes to **stderr** (the entry's logger forces every level there). If
  `pnpm -s` ever pollutes stdout, switch to `node --import tsx packages/mcp/src/main.ts`.
- **`projectPath` is a per-call argument** (stateless — one server serves any project).
  `CE_DEFAULT_PROJECT` pins a fallback used when a call omits it; `CE_WORKSPACE`
  relocates the engine scratch dir (defaults to repo-root `.workspace/`, gitignored).
  The target is only ever read — the engine's sole writer stays inside the workspace.
- Like md-log, it is a project-scoped server: a fresh (esp. cloud) session shows it
  `⏸ Pending approval` until approved once. User-level `~/.claude` / `claude mcp add`
  do not transfer to cloud VMs, so this server lives in `.mcp.json`, not user config.
- Run directly with `pnpm --filter @ce/mcp start` (or `dev` for watch). Both are
  long-running and **excluded from the verification gate**; only `typecheck` runs there
  (`@ce/mcp` has no `build` step — tsx runs the `.ts` sources).

### Large projects & timeouts

- The first `scan_project` on a big target (e.g. `brandvis-frontend`, 1000+ components)
  can run for minutes — the same cost the web host pays; the result is then cached, so
  `list_components` / `get_portable_code` / `customize_component` are fast afterward.
- The server forwards engine progress as MCP **progress notifications** on every scanning
  call (the stdio analogue of the host's WebSocket progress). A client that supplies a
  progress token and sets `resetTimeoutOnProgress` keeps the request alive across a long
  scan; otherwise raise the client's request timeout. Progress and all logs go to stderr,
  never stdout.
