# Plain REST resources via `retool resource explore`

Status: ready to implement · 2026-09-25 · Handoff brief (problem, evidence, solution, acceptance)

## Problem

Any endpoint that calls Fleet 360 fails under the local runner. Examples are
`getVehicleStatus`, `getVehicleContext` and the runbook matching in
`getShiftTimeline`, all in
`retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard`. The app logs:

```
fleet360 resource global is missing rawRequest (saw: query). Check package.json
resourceReferencesByFile lists this file, and that nothing in scope shadows the name.
```

(That message comes from `backend/shift/fleetApi.ts`, which checks for
`fleet360.rawRequest` before calling it.)

There are three stacked causes.

1. **The MCP cannot reach it.** `fleet360` (resource
   `a6feef9d-e246-4efe-b8c3-a60c1f309bdb`) is a plain `restapi` resource: a
   base URL and headers, no OpenAPI spec. `retool_get_resource_ts_definitions`
   refuses it with `restapi_missing_openapi_spec`: "Plain REST API resources
   with only a base URL are not available for MCP TypeScript resource querying."
   So the MCP proxy in `buildGlobals` (the `entry.kind === 'rest'` branch) can
   never work for it.
2. **The local override has the wrong method, and the wrong path form.**
   `.local-resources/resources.json` maps fleet360 to `createLocalRestResource`
   (`src/localRestResource.ts`). That returns `{ query(request) }` only.
   - Hosted Retool exposes `rawRequest({ method, path })` and
     `rawRequestStreamRaw`, which is what app code calls.
   - The local override also requires a leading `/`. The app strips it
     (`vehicle`, not `/vehicle`), because the hosted resource's base URL ends
     in `/`.
3. **A direct call is not authenticated.** Even with `rawRequest` added, the
   local override fetches `https://fleet360-external.wayve.dev` directly, and
   that host sits behind Cloudflare Access.
   - `GET /vehicle` from a laptop returns a **302** to the Cloudflare sign-in,
     and the override refuses redirects.
   - The Retool resource authenticates with headers filled from Retool
     environment variables: `CF-Access-Client-Id`, `CF-Access-Client-Secret`
     and `x-wayve-origin-*` (see `retool-ops/resources/fleet360/resource.json`).
   - The laptop has none of them, and they should not be copied locally.

## Decided solution

Send plain REST resources through **`retool resource explore`**. It runs the
TypeScript snippet on Retool's servers with the real resource and its stored
credentials: no secrets on the laptop, and no change to the production
resource.

Explicitly **not** doing:
- **Attaching an OpenAPI spec to `fleet360`.** It is a protected production
  resource, and we decided on 2026-09-15 not to change it just to make it
  MCP-queryable.
- **Copying Cloudflare Access tokens locally.**

### Verified behaviour of `retool resource explore` (2026-09-25, CLI at `~/Library/pnpm/bin/retool`)

- **Input and output.** It reads TypeScript from stdin, and the snippet must
  `return`. With `--json`, stdout is
  `{ ran, environment, classification, resources, data, truncated }`.
  - Check `ran`, not the exit code.
  - A refusal exits 1 with empty stdout and the reason on stderr.
- **Response shape.** `await fleet360.rawRequest({ method: 'GET', path: 'vehicle' })`
  returns `{ data: [...] }` (axios-style; there is no `status` key on success).
  Unknown paths return `{ data: {} }`, not an error.
- **Row cap.** Rows are capped at **100 by default**, including arrays inside a
  `{ data }` envelope. `/vehicle` has 361 rows today, so the adapter **must**
  pass `--rows` high enough (e.g. `--rows 5000`) and treat `truncated: true`
  as an error, never as a short list.
- **Working directory.** It must run from a CLI checkout: a directory with
  `.retool/app.json`, created by `retool clone <app-uuid> --branch <existing>`,
  with `pnpm install` done.
  - The retool-ops repo copy of the app has no `.retool/`, so explore will not
    run there.
  - The existing working clone is
    `~/Projects/retool-cli/comms-vehicle-status/ae20b4b6-70a3-11f1-bc93-1b5dd59a52d3/`.
  - Do not let `retool clone` create a new branch (omitting `--branch` does).
- **Writes.** It is read-only by default. `--allow-mutative` is needed for
  writes. Respect the runner's `writes` flag: only pass it when writes are on.
- **Latency.** About **2.7 s per call** (cold CLI process each time).

### Shape of the change

1. **New adapter**, `src/exploreRestResource.ts`,
   `createExploreRestResource(entry, opts)`. It returns an object with:
   - `rawRequest({ method, path, headers?, body? })`. It builds a snippet that
     calls `<binding>.rawRequest(<JSON of the request>)`, runs
     `retool resource explore --json --rows <N>` with the snippet on stdin
     (`cwd` = the configured CLI checkout), and resolves to the result's
     `data`, which is exactly what hosted `rawRequest` returns. It passes
     `--allow-mutative` only when `opts.writes` is on and the method is not
     GET/HEAD/OPTIONS; otherwise a mutating method throws
     `Write blocked (read-only mode)` before spawning.
   - `query(request)`, kept as an alias, so the existing
     `createLocalRestResource` callers and tests keep their meaning.
   - Serialize the request with `JSON.stringify` only. Never splice raw strings
     into the snippet.
   - Log through `logQuery` like the other adapters: method and path only, no
     bodies or headers.
2. **Route selection** in `buildGlobals`. For a `kind: 'rest'` entry whose MCP
   bindings are unavailable (the `restapi_missing_openapi_spec` case), use the
   explore adapter instead of the MCP proxy. Decide per resource once at
   startup, e.g. from the `unsupported_resources` list that
   `retool_get_resource_ts_definitions` returns, not per call.
3. **Precedence.** An explicit entry in `.local-resources/resources.json` still
   wins; that is how the Slack file-upload override works. **Remove the
   fleet360 entry** from `.local-resources/resources.json` so fleet360 falls
   through to explore. Keep `fleet360.openapi.yaml`; it is harmless.
4. **Config.** Add the CLI checkout path to `config.json`, e.g.
   `"exploreCheckoutDir"`. At startup, fail fast with a clear message if it has
   no `.retool/app.json`, or if `retool` is not on `PATH`.
5. **Also fix `localRestResource`** (small and independent). Add a
   `rawRequest` alias, and normalize a path without a leading `/` by
   prepending one. Any future local override then matches the hosted client's
   calling convention.
6. **Latency (optional, measure first).** A per-endpoint-call memo keyed on
   method + path for GETs within one `/rpc` request, so `Promise.all` fan-out
   does not spawn duplicate CLI processes. No cross-request cache: stale Fleet
   360 status is worse than slow.

## Acceptance

- The runner serves `getVehicleStatus` with params
  `{ country: 'uk', city: null, dateIso: <today>, shiftMode: 'am' }`, and the
  response has `fleet.ok === true` with London vehicles. Today it has
  `fleet: { ok: false, error: 'Fleet 360 unreachable' }`.
- `logs.app_events` (Lakebase) gets no new `getVehicleStatus` / `fleet360` warn
  rows from the runner.
- **Unit tests** (vitest, stub the child process):
  - the snippet serializes the request safely, including a path containing
    quotes or backticks;
  - `ran: false` becomes a thrown error;
  - `truncated: true` becomes a thrown error;
  - a mutating method in read-only mode throws before spawning;
  - `--rows` is passed;
  - `rawRequest` and `query` both work;
  - a `localRestResource` path without a leading slash is accepted.
- **No secrets anywhere.** No Cloudflare or Wayve header values appear in the
  runner repo, its logs or `config.json`.
- The existing test suite stays green.

## Out of scope

- Any change to the Retool `fleet360` resource or the retool-ops app code.
  `fleetApi.ts` is already correct for hosted Retool.
- Speeding up explore itself.
