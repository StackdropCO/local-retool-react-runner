# local-mcp-runner

Runs an existing Retool **apps-as-code** (React SDK) app **locally**, using the
Retool **MCP** as the backend/resource connection — no changes to the app, and
nothing written into the `retool-ops` repo.

Default target: `retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard`.

## Requirements

- Node 20+
- pnpm 10+ (`corepack enable` or `npm i -g pnpm`)

## Run

    pnpm install              # one-time: the tool's own deps
    pnpm start                # read-only (default) — the Shift Utilization Dashboard
    pnpm start -- --writes    # allow INSERT/UPDATE/DELETE via the MCP

First run opens a browser for Retool MCP OAuth; tokens cache under `.mcp-auth/`
and refresh automatically (later runs don't prompt). You need access to the
Retool org (`ops.wayve.retool.com`) to authorize.

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
