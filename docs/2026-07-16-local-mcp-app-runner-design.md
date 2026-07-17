# Local MCP App Runner — Design

**Date:** 2026-07-16
**Status:** Approved (pending spec review)
**Location:** `~/Projects/local-mcp-runner` (standalone npm project, **outside** the `retool-ops` git repo)

## Goal

Run a Retool "apps-as-code" (React SDK) app **locally**, end-to-end, using the
**Retool MCP** as the resource/backend connection. The first target app is
`retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard`.

The frontend source already exists. What's missing when running outside Retool:

1. the frontend **entry scaffolding** (`index.html`, entry, Vite/Tailwind config),
2. the **generated hooks** the frontend imports (`./hooks/backend/shift`),
3. a **backend** that executes `backend/shift/*.ts` against real resources.

Retool's own tooling normally provides all three (and proxies (3) to Retool
cloud). This tool replaces them locally, using `retool_execute_resource_ts` for (3).

## Hard constraint: never touch the git repo

The `retool-ops` repo is off-limits. This tool:

- **reads** the app source in place; never writes into the repo,
- writes **no** scaffold files into the app dir — the missing `./hooks/backend/shift`
  module is served as an **in-memory Vite virtual module**, not a file on disk,
- keeps all of its own code, config, caches, and logs under `~/Projects/local-mcp-runner`.

## Why the MCP fits

The app's backend functions call injected resource globals:

```ts
databricks.query<T>(sql)            // → { data: T[] }
lakebaseRetoolOltp.query<T>(sql)    // → { data: T[] }
connectteamapi.<ns>.<op>(...args)   // OpenAPI-annotated REST, typed op methods
```

`retool_execute_resource_ts(resourceNames, code)` runs a TS snippet server-side
using the **identical** resource-global model. So each shim global forwards its
call into an `execute_resource_ts` snippet. All three resources are supported
(the two SQL resources via `.query()`; ConnectTeamAPI because it is
OpenAPI-annotated — normal REST resources would not be, but this one is).

## Architecture — one Node process

```
Browser (Vite dev server)
   │  App.tsx → virtual hooks/backend/shift  → hook.trigger(params).result
   │      └── POST /rpc/:endpoint ──────────────────────────────┐
   ▼                                                            ▼
Node server (local-mcp-runner)                   ┌──────────────────────────────┐
  1. Vite (root = tool dir) w/ virtual-module    │ endpointRunner               │
     plugin + absolute import of app App.tsx      │  import backend/*.ts (tsx),  │
  2. POST /rpc/:endpoint                          │  inject resource globals,    │
  3. MCP client (standalone OAuth)                │  call fn({params, user})     │
                                                  └───────────────┬──────────────┘
                              globalThis.databricks / lakebaseRetoolOltp / connectteamapi
                                                                  │ .query(sql) / .op(...)
                                                                  ▼
                              executeResourceTs(resourceNames, code) → query log
                                                                  │
                                                                  ▼
                              Retool MCP (StreamableHTTP + OAuth, token cached to disk)
                                                                  │
                                                                  ▼
                              real Databricks / Lakebase / ConnectTeam resources
```

## Components

Each is a small, single-purpose module with a clear interface.

### 1. `src/mcpClient.ts`
- Connects to `https://ops.wayve.retool.com/mcp` using the MCP SDK
  `StreamableHTTPClientTransport` with an `OAuthClientProvider`.
- **Standalone OAuth:** first run opens the system browser to authorize; a
  loopback HTTP listener captures the callback; tokens (+ refresh) cached to
  `~/Projects/local-mcp-runner/.mcp-auth/tokens.json`. SDK handles refresh.
- Exposes `executeResourceTs(resourceNames: string[], code: string): Promise<unknown>`
  and `getResourceTsDefinitions(names)` / `listResources()` for startup resolution.
- Depends on: `@modelcontextprotocol/sdk`, an `open`-a-browser helper.

### 2. `src/queryLog.ts`  *(new requirement)*
- Appends **every** `executeResourceTs` call to a JSONL history so the inlined
  SQL ("the hardcoding" — prepared statements are disabled, SQL is inlined) is
  reviewable and diffable over time.
- Path: `~/Projects/local-mcp-runner/logs/queries-YYYY-MM-DD.jsonl`.
- Record: `{ ts, endpoint, resourceNames, code, ok, error?, rowCount?, durationMs }`.
- Written around the MCP call (both success and failure). Pure append; never read
  back by the runner. Interface: `logQuery(record)`.

### 3. `src/resourceGlobals.ts`
- Reads the app `package.json` `resourceReferencesByFile` → the set of
  `{name, displayName, type}` resources.
- At startup resolves, per resource: the **MCP resource name** (via
  `listResources`, matched on display/technical name) and the **binding variable
  name** (via `getResourceTsDefinitions`). Cached for the process.
- Builds shim globals:
  - **SQL** (`databricks`, `lakebaseRetoolOltp`): `.query(sql)` →
    `executeResourceTs([resourceName], "return await <binding>.query(<sql-json>)")`,
    returns the result unchanged (expected `{ data: [...] }`; normalization
    confirmed by the live probe below).
  - **REST** (`connectteamapi`): a JS `Proxy` capturing `ct.<ns>.<op>(...args)` →
    `executeResourceTs([resourceName], "return await <binding>.<ns>.<op>(...jsonArgs)")`.
    `deriveBands` already falls back gracefully on error.
- **Write gating:** `.query()` inspects the SQL; if it is a write
  (`INSERT|UPDATE|DELETE|...`) and the runner is not in `--writes` mode, it
  throws `WriteBlockedError` **before** calling the MCP. Read-only is the default.

### 4. `src/endpointRunner.ts`
- Sets `globalThis.databricks / lakebaseRetoolOltp / connectteamapi` to the shims.
- Imports each `backend/shift/*.ts` with a default export via a TS-capable loader
  (`tsx`). Bare global references resolve to the injected `globalThis` props at
  call time.
- `run(endpoint, params)` → `fn({ params, user: <stub user> })` → return value.
- Stub `user`: minimal `{ email, ... }` shape the functions read (verified against
  usage; currently only `req.user` is destructured — filled with a fixed dev user).

### 5. `src/vitePlugin.ts`
- Vite plugin: `resolveId`/`load` intercept the resolved path
  `<app>/frontend/hooks/backend/shift` and serve an in-memory module exporting
  `useGetShiftTimeline`, `useClassifyGap`, `useInvalidateGap`, `useAddReasonCode`
  (and any other default-export endpoints discovered).
- Generated hook shape (matches Retool SDK usage in `App.tsx`):
  ```ts
  export function useX() {
    return { trigger: (params, _opts) => ({ result: post('/rpc/x', params) }) }
  }
  ```
  where `post` returns a `Promise` resolving to the backend return value. Only
  `.trigger(params, opts).result` is consumed by the app — no `.data`/`.isLoading`
  needed.

### 6. `src/server.ts` + `src/index.ts`
- Creates the Vite dev server in **middleware mode**, mounts an HTTP server that
  serves the app and handles `POST /rpc/:endpoint`, `/health`, and the OAuth
  `/auth/callback`.
- CLI (`src/index.ts`): `--app "<abs path to app dir>"` (default: the Shift
  Utilization Dashboard), `--writes` (default off → read-only), `--port`.
- Vite root = tool dir; a generated `index.html` + `main.tsx` (in the tool dir)
  import the app's `App.tsx` by absolute path.

## Data flow (getShiftTimeline)

`App` → `timeline.trigger(params).result` → `POST /rpc/getShiftTimeline` →
`endpointRunner.run('getShiftTimeline', params)` →
`getShiftTimeline({params,user})` → `databricks.query(sql)` /
`lakebaseRetoolOltp.query(sql)` shims → `executeResourceTs` (logged) → MCP →
resources → JSON back up the chain → `extractTimeline`/`adaptTimeline` in the app.

## Error handling

- MCP/tool errors throw inside `.query()`; `queryWithRetry` and the frontend
  `.catch()` already handle them (cold-warehouse retry, load-error banner).
- `WriteBlockedError` in read-only mode → 4xx with a clear message; surfaced in
  the app's toast.
- OAuth failure/expiry → server logs a re-auth URL; the SDK refreshes when possible.
- Unknown endpoint → 404.

## First implementation step: live probe

Before wiring everything, a one-shot script calls `executeResourceTs` against
Databricks (`SELECT 1`) and Lakebase (a trivial `SELECT`) to **lock the exact
return shape** (`{data}` vs raw array vs `{rows}`), confirm binding names, and
confirm OAuth. The `.query()` normalization is finalized from this evidence.

## Testing

- **Unit (pure functions):** SQL-vs-write detection, SQL→snippet builder, REST
  Proxy→snippet builder, result normalization, query-log record shape.
- **Live smoke (flagged):** boot server read-only, hit `/rpc/getShiftTimeline`,
  assert a non-empty adapted payload; assert a write is blocked without `--writes`.

## Risks / open items

- **Writes hit production Lakebase** — mitigated by read-only default + explicit
  `--writes`.
- **`execute_resource_ts` result shape / statement acceptance** — resolved by the
  live probe; normalization may need a tweak after first run.
- **MCP OAuth specifics** (dynamic client registration, callback port, scopes) —
  unknown until first contact; built on the SDK's standard auth provider,
  defensively.
- **ConnectTeam Proxy op coverage** — only the one op used by `deriveBands` is
  exercised; graceful fallback covers gaps.

## Scope

First target: the one app. `--app` parameterizes the path so other `apps-v2`
apps can reuse the runner later. Not building a generic MCP tool explorer.
