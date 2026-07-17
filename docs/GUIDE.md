# Local MCP Runner — Team Guide

Run Retool **apps-as-code** (React SDK apps) on your laptop, wired to **real** Retool
resources through the Retool **MCP** — no changes to the app, nothing written to your
apps repo. This doc goes from *how to use it* → *how it works* → *how it's built*.

---

## 1. TL;DR

- A Retool app-as-code is two halves: a **frontend** (a normal Vite/React app) and a
  **backend** (`.ts` functions that call resources like Databricks/Lakebase/APIs).
- The frontend runs anywhere. The backend normally only runs inside Retool's cloud,
  which injects the resource connections. Locally, that half is missing.
- This tool **stands in for Retool's backend**: it serves the app, runs the app's own
  backend functions, and routes their resource calls through the MCP tool
  `retool_execute_resource_ts`.
- You bring **your own MCP URL** and **your own apps repo**. No org/machine defaults.

---

## 2. How to use it

### 2.1 Requirements
- Node 20+
- pnpm 10+ (`corepack enable`, or `npm i -g pnpm`)
- Access to your Retool org (to authorize the MCP) and a local checkout of your apps repo

### 2.2 Install
```bash
cd local-mcp-runner
pnpm install
```

### 2.3 Easiest path — the control panel
```bash
pnpm panel        # → http://localhost:5170
```
Then, in the browser:
1. **MCP connection** — enter your MCP URL (e.g. `https://<your-org>.retool.com/mcp`),
   click **Save URL**, then **Connect / Authorize**. A browser tab opens once to log in;
   the token is cached.
2. **Resources** — **Load readable resources** to see what your org exposes and which
   are queryable.
3. **Apps** — **Browse…** to your apps repo, **Scan for apps**, then **Run** on any app
   (tick *enable writes* only if you need to persist changes).
4. **Running** — Open / Stop each launched app. Each runs on its own port.

Your MCP URL and repo directory are **remembered** across restarts.

### 2.4 Terminal alternative
```bash
pnpm start -- --app "/path/to/apps-v2/<Group>/<App>" --mcp-url "https://<org>.retool.com/mcp"
pnpm dev   -- --app "/path/to/app"     # same, auto-restarts on backend/tool edits
pnpm start -- --app "/path/to/app" --writes   # allow INSERT/UPDATE/DELETE
```
`--app` is required (or use the panel). The MCP URL comes from `--mcp-url`, the
`RETOOL_MCP_URL` env var, or whatever you saved in the panel. `--port` defaults to 5174.

### 2.5 Editing while it runs
- **Frontend** edits (`App.tsx`, `components/`, `lib/`, CSS) hot-reload in the browser (Vite HMR) — no restart.
- **Backend** edits (`backend/**/*.ts`) restart the server automatically under `pnpm dev`
  and for panel-launched apps. After a backend reload, refresh the browser to re-fetch.

---

## 3. Top-level concept

### 3.1 The gap
Run the frontend locally and it's half a car — wheels turn, no engine. The "engine" is
the backend's connection to real data, which only exists in Retool's cloud.

### 3.2 The borrowed engine
The MCP has a fixed **in → out** contract:
> **in:** "run this TypeScript snippet against resource X" → **out:** the result as JSON.

That's `retool_execute_resource_ts`. Crucially, the snippet it runs uses the **same
programming model** the app's backend already uses (`databricks.query(sql)`,
`lakebaseRetoolOltp.query(sql)`). So the MCP isn't an adapter we bend the app to fit —
it's the same shape the backend was written for.

### 3.3 What the tool is
A thin **shim** that impersonates Retool's runtime, filling three gaps Retool's cloud
normally fills:

| Gap Retool normally fills | Our stand-in |
|---|---|
| Generates the `hooks/backend/<group>` module | A Vite **virtual module** |
| Runs the backend `.ts` functions | Our `/rpc/:endpoint` **runner** |
| Injects the resource connections | **Fake globals** that forward to the MCP |

---

## 4. Architecture & data flow

```
Browser (Vite dev server, per app)
   │  App.tsx → virtual hooks/backend/<group>
   │      useX().trigger(params).result ──POST /rpc/<endpoint>──┐
   ▼                                                            ▼
Node runner (tsx)                                ┌──────────────────────────────┐
  • Vite middleware (serves the app in place)    │ endpointRunner               │
  • POST /rpc/:endpoint                           │  import backend/**/<ep>.ts    │
  • MCP client (standalone OAuth, per-host token) │  inject resource globals      │
                                                  │  call default({params,user})  │
                                                  └───────────────┬──────────────┘
                    globalThis.databricks / lakebaseRetoolOltp / connectteamapi
                                                                  │ .query(sql) / .op(...)
                                                                  ▼
                    executeResourceTs(resourceNames, code)  ──►  Retool MCP  ──► real resources
                                     │
                                     └── every call appended to logs/queries-*.jsonl
```

**One request, end to end (example `getShiftTimeline`):**
```
useGetShiftTimeline().trigger({geo:'lhr'}).result
 → POST /rpc/getShiftTimeline {params:{geo:'lhr'}}
 → runner runs backend/shift/getShiftTimeline.ts({params, user})
     → lakebaseRetoolOltp.query("SELECT … FROM shift_ops.gap_classifications …")
         → mcp.executeResourceTs(["089dd…"], 'return await lakebaseRetoolOltp.query("SELECT …")')
         → MCP → real Lakebase → { data:[…] }   (logged)
     → returns { window, reasonCodes, vehicles }
 → JSON → hook .result promise → app renders
```

---

## 5. Implementation

### 5.1 File map (`src/`)
| File | Responsibility |
|---|---|
| `paths.ts` | Derived tool root, per-host auth dir, MCP URL (env/empty), logs dir |
| `config.ts` | Persist MCP URL + last repo dir to git-ignored `config.json` |
| `oauthProvider.ts` | File-backed OAuth token store (per host) + loopback callback |
| `mcpClient.ts` | Connect to the MCP (standalone OAuth); `executeResourceTs`, `getResourceBindings`, `listResources` |
| `snippets.ts` | Build the TS snippets + detect write statements (pure) |
| `resourceGlobals.ts` | Resolve resources → build the fake globals (SQL object / REST Proxy) |
| `endpointRunner.ts` | Inject globals on `globalThis`, import + run the backend endpoint |
| `vitePlugin.ts` | Serve the missing `hooks/backend/<group>` as a virtual module |
| `server.ts` | Vite middleware + `/rpc/:endpoint`; dep aliasing; endpoint discovery |
| `index.ts` | Single-app CLI entry (`pnpm start`) |
| `dev.ts` | Watch-mode launcher (restarts on backend/tool changes) |
| `scan.ts` | Find apps under a repo dir (for the panel) |
| `panel/server.ts` + `panel/index.html` | The control-panel API + UI |
| `scripts/probe.ts` | Diagnostic: connect + `SELECT 1` |

### 5.2 The three seams

**Seam 1 — the hook module (`vitePlugin.ts`).**
The app imports `./hooks/backend/<group>`, which doesn't exist on disk. The plugin
intercepts any import matching `hooks/backend/<group>` and serves an in-memory module.
Per discovered endpoint it emits a stateful React hook:
```js
export function useGetShiftTimeline() {
  const [state, setState] = useState({ data: undefined, isFetching: false, error: undefined })
  return { ...state, trigger: (params) => ({ result: post('/rpc/getShiftTimeline', params) }) }
}
```
So `use<Endpoint>()` ⟶ `POST /rpc/<endpoint>`. Endpoints come from `discoverEndpoints()`
walking `backend/**` for files with a `default export`.

**Seam 2 — running the real backend (`endpointRunner.ts`).**
`POST /rpc/:endpoint` → `run(endpoint, params)`:
1. sets the resource globals on `globalThis`,
2. dynamically `import()`s the app's actual `backend/**/<endpoint>.ts`,
3. calls its `default({ params, user })` and returns the value as JSON.

**Seam 3 — the resource globals ARE the MCP mapping (`resourceGlobals.ts`).**
This is the shim. The backend calls a bare variable like `databricks.query(sql)`. In
Retool's cloud, Retool creates `databricks`. Locally it's undefined → `ReferenceError`.
So we build a **fake object with the same shape** and drop it into the same slot.

### 5.3 The fake global (the "shim"), concretely
```ts
// SQL resource: same .query() the backend expects, but forwards to the MCP
databricks = {
  query: async (sql) => {
    if (readOnly && isWrite(sql)) throw new WriteBlockedError(sql)   // write-gate
    return mcp.executeResourceTs(
      [resourceId],
      `return await databricks.query(${JSON.stringify(sql)})`,        // the "translation"
    )
  }
}
```
The "translation" is just **re-typing the call as a string** to hand to the MCP, whose
input is a text snippet. For REST resources (unknown method names like
`connectteamapi.schedulev1.getShifts(...)`) we use a JS **Proxy** that captures any
property path + args and rebuilds the same call as a string.

### 5.4 How it's dynamic (no hardcoded resources)
```
app package.json (resourceReferencesByFile)  →  [{id, displayName, type}, …]   (per app)
                       │
ask MCP getResourceBindings(ids)             →  {id → variable name}
                       │
loop → build one shim per resource            →  sql = {query}, rest = Proxy, keyed by binding name
                       │
loop → globalThis[binding] = shim             →  backend's bare vars resolve to our shims
```
The only thing hardcoded is the **pattern** (SQL→`.query`, REST→Proxy), never the
specific resources. The binding name comes from the MCP, so our fake has the same name
the backend uses — that's the pivot that makes it work for any app.

### 5.5 Auth
- Standalone OAuth via the MCP SDK (dynamic client registration + PKCE).
- On first connect to a host, a browser opens to log in; tokens cache per host under
  `.mcp-auth/<host>/` and refresh automatically. Multiple orgs never collide.

### 5.6 Safety & observability
- **Read-only by default.** `INSERT/UPDATE/DELETE/…` are detected in the SQL shim and
  blocked *before* the MCP call unless `--writes` (or the panel checkbox) is set.
- **Query history.** Every `executeResourceTs` call is appended to
  `logs/queries-YYYY-MM-DD.jsonl` (resource, exact SQL/code, ok/error, row count,
  duration) — a diffable record of what actually ran.
- **Nothing is written into your apps repo** — app source is read in place; the missing
  hooks are a virtual module; scaffolding/config lives in the tool dir.

---

## 6. Resource support & limits

| Resource kind | Supported? | How |
|---|---|---|
| SQL (Databricks, Lakebase, Postgres, MySQL, Snowflake, …) | ✅ | `.query(sql)` shim |
| REST with OpenAPI annotations (e.g. ConnectTeam) | ✅ | Proxy → typed op call |
| Plain (non-OpenAPI) REST, GraphQL, S3, etc. | ⚠️ | Not queryable via `execute_resource_ts` today; would need a per-type shim |

**Known limit — heavy queries.** `execute_resource_ts` is tuned for agent-sized queries.
Very heavy analytical queries can exceed its gateway (observed: a 502 on one large
minute-grain query, and a timeout on another). Light/medium queries — the bulk of any
app — flow through fine. The query log shows exactly which call failed.

---

## 7. Persistence, ports, multi-user

- **`config.json`** (git-ignored) stores your MCP URL and last repo dir; the panel
  pre-fills both on load.
- **Tokens** live under `.mcp-auth/<host>/` (git-ignored).
- **Ports:** panel on 5170; apps start at 5174 upward, skipping any port already in use.
  Running the same app twice reuses the existing instance instead of duplicating.
- **Per-user:** MCP URL + repo dir + tokens are all per-user; nothing org-specific is
  baked into the code.

---

## 8. Sharing / repo setup

The tool is its own standalone project (separate from your apps repo). To share:
```bash
# from a clean export (no node_modules, no .mcp-auth, no config.json):
cd local-mcp-runner-share
git init && git add . && git commit -m "Initial commit"
git remote add origin <repo-url> && git push -u origin main
```
Teammates then: `pnpm install` → `pnpm panel` → enter their own URL + repo. Tests are
path-independent (they skip unless `RETOOL_TEST_APP` points at a real app), so
`pnpm test` is green on any machine.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "no MCP URL" | Set it in the panel (Save URL) or pass `--mcp-url` / `RETOOL_MCP_URL`. |
| "no app found" | Pass `--app "/abs/path"`, or use the panel's Browse → Scan. |
| Browser opens every run | Token missing/expired for that host; re-authorize once. |
| A query returns 502 / timeout | Heavy query exceeding the MCP gateway (see §6). Check `logs/queries-*.jsonl`. |
| Write "blocked (read-only mode)" | Intended. Re-run with `--writes` / tick *enable writes*. |
| Backend edit didn't show | Refresh the browser after the auto-restart; frontend edits are instant, backend results re-fetch on the next call. |
| Port already in use | The runner auto-skips busy ports; a hard-killed panel can orphan a child — stop it or pick another port. |

---

## 10. Commands reference

| Command | What it does |
|---|---|
| `pnpm install` | Install the tool's dependencies |
| `pnpm panel` | Control panel at http://localhost:5170 |
| `pnpm start -- --app "…"` | Run one app (read-only) |
| `pnpm start -- --app "…" --writes` | Run one app with writes enabled |
| `pnpm dev -- --app "…"` | Run one app with auto-restart on backend/tool changes |
| `pnpm test` | Unit tests (path-independent) |
| `pnpm run probe` | Diagnostic: connect + `SELECT 1` |
