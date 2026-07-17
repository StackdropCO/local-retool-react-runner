# local-mcp-runner

Runs an existing Retool **apps-as-code** (React SDK) app **locally**, using the
Retool **MCP** as the backend/resource connection — no changes to the app, and
nothing written into your apps repo.

No org/machine defaults are baked in: you provide your own **MCP URL** and your
own **apps repo directory** (both are saved after first use).

## Requirements

- Node 20+
- pnpm 10+ (`corepack enable` or `npm i -g pnpm`)

## Install (first time)

1. **Get the code** — unzip `local-mcp-runner.zip` (or clone the repo), then:
   ```
   cd local-mcp-runner
   ```
2. **Install dependencies:**
   ```
   pnpm install
   ```
3. **Have your Retool apps repo** checked out somewhere. The tool reads app
   source from there; it never writes to it.
4. **Start the control panel:**
   ```
   pnpm panel        # → http://localhost:5170
   ```
5. **In the panel:** enter **your** MCP URL (e.g. `https://<your-org>.retool.com/mcp`),
   click **Save URL**, then **Connect / Authorize** — a browser tab opens once to
   log in to your Retool org; the token is cached for next time.
6. **Browse** to your apps repo folder → **Scan** → pick a **branch** in the dropdown
   next to the app (defaults to the checked-out one) → click **Run**. It opens on its
   own port. Your MCP URL and repo dir are remembered for next time.

**Branches:** running a branch other than the one currently checked out uses an isolated
**git worktree** (created under `.worktrees/`, reused after that) — so it reflects that
branch **without touching your working tree or requiring a `git checkout`**. From the CLI:
`--branch <name>`.

Prefer the terminal? Provide both the app and the MCP URL:
```
pnpm start -- --app "/abs/path/to/apps-v2/<Group>/<App>" --mcp-url "https://<your-org>.retool.com/mcp"
```
(Once set in the panel, the saved URL is reused, so `--mcp-url` becomes optional.)

## Control panel (easiest start)

    pnpm install
    pnpm panel                # http://localhost:5170

A small web UI to: set the **MCP URL** + authorize (and see auth/connection
status), list your org's **resources** (with a "queryable" flag), **scan** an
apps repo directory for apps, and **run / stop** any app with one click
(optionally with writes). Each app launches on its own port. Everything is
also available from the CLI.

## Run (CLI)

    pnpm install                                   # one-time: the tool's own deps
    pnpm start -- --app "/path/to/app"             # read-only (default)
    pnpm dev   -- --app "/path/to/app"             # same, but auto-restarts on changes
    pnpm start -- --app "/path/to/app" --writes    # allow INSERT/UPDATE/DELETE via the MCP

`--app` is required (or use the panel). The MCP URL comes from `--mcp-url`, the
`RETOOL_MCP_URL` env var, or whatever you saved in the panel. `--port` picks the
port (default 5174).

### Reloading on changes

- **Frontend** edits (the app's `App.tsx`, `components/`, `lib/`, CSS) hot-reload
  in the browser via Vite — no restart.
- **Backend** edits (the app's `backend/**/*.ts` — queries, endpoints) and the
  tool's own `src/**` run in the Node process. Under `pnpm dev` they trigger an
  automatic server restart; under `pnpm start` you restart manually.

### Auth

When you first connect to a given MCP URL, a browser tab opens to log in to that
Retool org. The token is cached per-host under `.mcp-auth/<host>/` and refreshes
automatically, so later runs don't prompt. In the panel this happens when you
click **Connect / Authorize**; from the CLI it happens on first run. You need
access to whichever Retool org the MCP URL points at.

## Adding another app (one command)

    pnpm start -- --app "/abs/path/to/any/apps-v2/app" --port 5175

Everything is auto-detected from the app: its frontend deps are installed into
this tool's `node_modules` on startup, endpoints are discovered under
`backend/**` (any group dir — `shift/`, `readiness/`, …), the `hooks/backend/<group>`
import is served virtually, and resources are read from the app's `package.json`.
The app's entry is always `frontend/App.tsx`; `orgTheme.css` is optional.

## How it works

- **Vite** (root = this dir) serves the app's real `frontend/App.tsx` (aliased
  `@app`). The app's frontend deps are installed here (via pnpm) and aliased so imports resolve.
- The app imports `./hooks/backend/shift`, which Retool normally generates. We
  serve it as an **in-memory Vite virtual module** — the hooks POST to
  `/rpc/:endpoint`.
- `POST /rpc/:endpoint` runs the app's own `backend/shift/<endpoint>.ts` with the
  resource globals injected: `databricks`, `lakebaseRetoolOltp`, `connectteamapi`.
- Each global forwards its call into `retool_execute_resource_ts` over a
  standalone-OAuth MCP client. The result shape (`{ data: [...] }`) matches what
  the backend expects.

## Query history

Every MCP `execute_resource_ts` call is appended to
`logs/queries-YYYY-MM-DD.jsonl` — resource, the exact SQL/code, ok/error, row
count, duration. Because prepared statements are off (SQL is inlined), this is a
full, diffable history of what actually ran.

## Read-only vs writes

Read-only is the default: any `INSERT/UPDATE/DELETE/...` is detected in the SQL
shim and blocked **before** it reaches the MCP. Pass `--writes` to allow them
(they hit production Lakebase — there is no sandbox).

## Status (verified 2026-07-17, live)

Working end-to-end through the MCP connector:
- OAuth connect + token refresh
- Databricks reads (window query)
- ConnectTeam REST (OpenAPI op `getShifts`) via the Proxy shim
- Lakebase reads (gap classifications, reason codes)
- Write-gating (INSERT blocked in read-only mode)
- Query history logging

Known gap:
- **`getShiftTimeline`'s main minute-grain timeline query returns HTTP 502**
  from the Databricks execution path via `retool_execute_resource_ts`. Simple and
  medium Databricks queries, and small scans of the same base tables, succeed;
  only this heavy multi-catalog query (it builds a per-minute grid with
  `LATERAL VIEW explode(sequence(...))` across four catalogs) is rejected. The
  failure is fast (~2s) with an empty `logs` array and a truncated gateway HTML
  body, so the root cause is not visible client-side — diagnosing it further
  needs Retool-side execution logs. All other dashboard data loads.

## Probe

`pnpm run probe` connects, lists resource bindings, and runs `SELECT 1` against
Databricks — a quick check that OAuth and the resource path are healthy.
