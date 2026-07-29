# PRD — Local MCP Runner

| | |
|---|---|
| **Status** | Draft |
| **Owner** | Arsany |
| **Last updated** | 2026-07-29 |

## Summary
A local dev tool that runs Retool "apps-as-code" (React SDK) apps on the developer's
machine against **real** Retool resources, by routing the app's backend/resource calls
through the Retool MCP. Includes a control panel to connect, discover apps, and run any
app on any git branch.

## Background / problem
Retool apps-as-code have a Vite frontend plus backend `.ts` functions whose resource
connections only exist in Retool's cloud. Today engineers must push to Retool to see
changes against real data — a slow, blind loop, and painful for reviewing a branch. There
is no way to run one of these apps locally with live data.

## Goals
- Run any apps-v2 app locally with live resource data.
- Read-only by default; writes require explicit opt-in.
- Run a chosen **git branch** without disturbing the working tree.
- Zero org/machine assumptions — each user supplies their own MCP URL + repo.
- Clear status: connected? which branch/commit is running? did the query succeed?

## Non-goals
- Not a Retool replacement, deploy tool, or hosted service.
- Not a generic MCP client / tool explorer.
- Not responsible for resource types the MCP can't execute (non-OpenAPI REST, etc.).

## Users
Engineers who build or review apps-v2 apps. Comfortable with terminal + git; not familiar
with this tool's internals.

## Requirements

### Must have (v1 — shipped)
1. **Connect to an MCP** by URL; OAuth login (browser) with cached, auto-refreshed token;
   supports multiple orgs. Persist the URL.
2. **Discover apps** in a local repo dir (type a path or browse the filesystem). Persist
   last-used dir. List each app's name, group, endpoints, resources, branch.
3. **Run an app**: pick branch (default = current) + writes toggle (default off) → launches
   on a free port; multiple concurrent runs; reuse an already-running app+branch.
4. **Branch isolation**: non-current branches run from a git worktree; the working tree is
   never touched.
5. **Manage runs**: list running apps (branch, port, writes) with Open / Stop.
6. **Edit loop**: frontend hot-reloads; backend edits auto-restart the runner.
7. **Safety**: writes blocked unless enabled; write-enabled runs clearly marked.
8. **Observability**: every executed query logged (resource, statement, ok/error, rows,
   duration).
9. **Resource list** with a "queryable via MCP" indicator.

### Should have (next)
- **Run the remote's latest**: `git fetch` + run `origin/<branch>` so "run main" reflects
  merged code even when local is behind. Show the short commit SHA per run.
- Design polish of the control panel (clean, navy, non-generic).

### Could have (later)
- Shims for more resource types (Postgres/GraphQL/S3, prepared-statement params).
- Per-run environment selection (`--env`).
- Worktree cleanup; multi-repo discovery view.

## UX (control panel, one page, four sections)
1. **MCP connection** — URL + Save + Connect; shows token-cached and connected status.
2. **Resources** — load + list with queryable badge.
3. **Apps** — repo dir + Browse + Scan → app cards with branch dropdown, writes toggle, Run.
4. **Running** — live list with Open / Stop.

Each section needs empty, loading, success, and error states. Also available via CLI
(`pnpm start/dev`, flags `--app`, `--branch`, `--mcp-url`, `--writes`, `--port`).

## Success metrics
- Time from clone → first running app < 2 min.
- % of runs reaching "serving" without error.
- Weekly repeat usage per engineer.
- Fewer "is it connected / which branch am I on" questions.

## Dependencies
- Retool MCP endpoint + org access; `retool_execute_resource_ts`.
- Node 20+, pnpm 10+, local git checkout of the apps repo.

## Risks / open questions
- **Stale local branch** → running it shows pre-merge code (mitigation: run `origin/<branch>` + show SHA).
- **Heavy queries** can exceed the MCP gateway (timeout/502) — must fail visibly, not hang.
- **Unsupported resource types** aren't queryable via MCP — must be flagged.
- Auth expiry / multiple orgs — re-auth must be low-friction.

## Rollout
Shared as a standalone repo; engineers `pnpm install` → `pnpm panel`. Docs: README
(install) + GUIDE (concept → setup → internals).
