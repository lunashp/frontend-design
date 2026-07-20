# component-explorer

Read an existing React+TS project (read-only), classify & visualize its design
components, extract portable code, and re-theme it.

## Stack

- **pnpm@10.25.0** monorepo (Turborepo). Use **pnpm only** — never `npm` or `yarn`.
- Node >= 20.11. TypeScript. Vitest for unit tests. Playwright for browser/E2E.
- Packages: `packages/core`, `packages/host`, `packages/web`, `packages/mcp`.

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
