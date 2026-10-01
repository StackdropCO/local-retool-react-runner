# Retool React Local Runner

Run Retool React apps locally from either a Retool CLI checkout or a protected
Apps as Code Git repository while backend queries use authenticated Retool
resources.

The control panel keeps the two source workflows separate. Unprotected apps can
be cloned, pulled, edited, run, and preview-pushed through the Retool CLI.
Protected apps remain in Git branches and worktrees; their matching CLI checkout
is used only as the Retool authentication and resource bridge. The runner never
pushes Git changes on its own and cannot publish an app live.

> [!NOTE]
> Retool React Local Runner is a Stackdrop project built for Retool Apps as
> Code. It is not an official Retool product. The package and CLI are currently
> named `local-mcp-runner`.

## What's new in this release

- **Environment-aware previews:** choose staging or production in the panel or
  CLI. Staging is the default, and the environment is forwarded to every Retool
  resource call.
- **Safer production controls:** the panel confirms production previews, write
  mode remains explicit, and a running app cannot silently change environment
  or write mode.
- **Resource preflight checks:** the runner validates required resources in the
  selected environment before serving the app. The panel links missing resources
  directly to their Retool configuration pages.
- **Agent-ready typechecking:** coding agents and LLMs can typecheck a CLI
  checkout directly and consume stable JSON diagnostics without starting a
  preview or generating files in the app.
- **App-level test execution:** run an Apps as Code app's local Vitest suite
  through the runner with `--root`, without installing Vitest in the app
  repository.
- **Hybrid local development:** the Apps and Settings pages separate Retool CLI
  checkouts from protected Git sources. Git worktrees get independent processes,
  ports, and Vite caches while retaining the matching CLI resource bridge.
- **Improved local REST support:** private OpenAPI resources remain outside the
  apps repo, are filtered to the selected app, and can be inspected, validated,
  and updated through the panel.
- **Public project foundation:** new public-facing documentation, safer local
  data guidance, Apache-2.0 licensing, and Stackdrop attribution.

## Feature overview

### Local React runtime

- Runs the checked-in `frontend/App.tsx` with Vite—no generated app copy.
- Hot-reloads frontend components, libraries, and CSS.
- Executes the app's checked-in TypeScript backend endpoints locally.
- Restarts backend and runner code automatically under `pnpm dev`.
- Installs missing frontend packages into the runner, never the apps repo.
- Supports several simultaneous app and worktree previews on isolated ports and
  Vite caches.

### Control panel

- Signs in with Retool CLI and lists available apps automatically.
- Uses one saved parent folder and clones each app into its own UUID child folder.
- Scans every Retool CLI checkout below that parent folder.
- Keeps separate **CLI checkouts** and **Git** tabs on both Settings and Apps.
- Scans a protected Apps as Code repository and displays its Git worktree metadata.
- Matches each Git app to its own CLI checkout by Retool app UUID.
- Selects staging or production and read-only or write-enabled execution per app.
- Confirms production launches and write access explicitly.
- Starts, opens, monitors, and stops independent app previews.
- Creates a Retool preview build only after a message and explicit push confirmation.
- Does not expose a live-publish action.
- Shows the active environment and write mode for every running app.
- Reports environment-specific missing resources with direct Retool links.
- Lists, opens, validates, and atomically saves private local OpenAPI documents.

### Retool resources and safety

- Uses `retool auth login` credentials and a `retool clone` checkout.
- Resolves resources by UUID from the app manifest and keeps them scoped to the
  backend endpoint that declared them.
- Supports SQL `.query(sql)` and `.query(sql, params)` interfaces.
- Supports OpenAPI-annotated REST resources through dynamic method proxies.
- Can execute configured private REST resources locally from an OpenAPI policy.
- Defaults to staging and read-only execution; write mode is opt-in.
- Records resource calls, outcomes, failures, row counts, and duration in local
  JSON Lines query history.

### CLI workflow and automation

- Uses an independent `retool clone` checkout per app for generated resource
  bindings and Retool credentials. For CLI apps it is also the editable source;
  for protected apps the editable source remains in Git.
- Makes clone, pull, and preview push explicit panel actions; live publishing
  remains outside the runner.
- Validates existing Git worktrees without creating or switching them.
- Typechecks an app's frontend and backend against virtual Retool hooks and
  manifest-backed resource globals.
- Produces human-readable diagnostics or stable JSON for scripts, coding agents,
  and LLM repair loops.
- Leaves generated hooks, declarations, configuration, and dependencies out of
  the apps repository.

## Requirements

- Node.js 22 or newer (required by the Retool CLI).
- pnpm 11 (`corepack enable` is recommended; this repository pins pnpm 11.5.0).
- Retool CLI (`pnpm add --global @tryretool/cli`).
- Git (used internally by the Retool CLI and as the source for protected apps).
- Access to a Retool organization and a local parent folder for cloned apps.
- For protected apps, access to the organization's Apps as Code Git repository.

## Quick start

Clone and install the runner:

```sh
git clone https://github.com/StackdropCO/local-retool-react-runner.git
cd local-retool-react-runner
corepack enable
pnpm install
```

Start the control panel:

```sh
pnpm panel
```

Open [http://localhost:5170](http://localhost:5170). The shared MCP metadata
connection appears above the two source settings and is used only to discover
groups for the emulated current user.

Under **Settings → CLI checkouts**, the panel automatically detects the installed
Retool CLI, its default authenticated host, and available apps. If authentication
is missing or expired, sign in there; then choose one absolute parent folder.
Every app you clone gets its own UUID child folder inside it. You can use the
same layout directly from a terminal:

```sh
retool auth login --host example.retool.com
retool apps
mkdir -p /path/to/retool-apps
cd /path/to/retool-apps
retool clone <app-uuid>
cd <app-uuid>
pnpm install
```

For a CLI app:

1. Open **Apps → CLI checkouts**. The panel scans the saved parent folder automatically.
2. Select the environment and write mode on the app card, then choose **Run**.
3. Edit locally and repeat until the app is ready.
4. Run `retool check` inside the app checkout.
5. On that app's card, choose **Push preview**, enter a message, and confirm the push.

For a protected Git app:

1. Under **Settings → Git**, select the Apps as Code repository.
2. Clone the same app once under **Settings → CLI checkouts** so the runner has
   its Retool credentials and generated resource bindings.
3. Open **Apps → Git**, select the desired existing branch or worktree, then choose **Run**.
4. Edit, commit, and push through Git or your coding agent. The runner does not
   perform Git pushes.

Each preview opens on its own port and watches the selected source files directly.

> [!WARNING]
> A production preview uses production Retool resources. Read-only mode blocks
> common SQL mutation statements, but it is not a complete sandbox. Enabling
> writes allows calls that can change real data. Query history also records the
> exact SQL or resource code and positional parameters locally; treat those logs
> as potentially sensitive.

## Control panel

The control panel is the easiest way to:

- Sign in with Retool CLI and list available apps.
- Choose one local apps folder and clone apps into automatic UUID subfolders.
- Choose a separate protected Apps as Code Git repository.
- Switch between **CLI checkouts** and **Git** on the Apps page.
- Pull an individual CLI app's latest source from its app card.
- Inspect resources generated in the Retool CLI checkout.
- Scan a Retool CLI app checkout.
- Select an existing Git branch or worktree for a protected app.
- Choose staging or production.
- Start, monitor, and stop app previews.
- Push a tested checkout to a Retool preview after explicit confirmation.
- Configure private local OpenAPI resources.

Connection and process state remain visible in the header. Write access is off
by default and requires confirmation. Production also requires confirmation,
including for read-only previews.

```sh
pnpm panel # http://localhost:5170
```

## CLI reference

### Commands

| Command | Purpose |
| --- | --- |
| `pnpm panel` | Open the control panel. |
| `pnpm start -- --checkout <path>` | Run one CLI checkout until the process is stopped. |
| `pnpm dev -- --checkout <path>` | Run one CLI checkout and restart its backend when source files change. |
| `pnpm typecheck -- --app <path>` | Typecheck one app directly. |
| `pnpm exec vitest run --root <app-path>` | Run an app's local Vitest suite using the runner's installed Vitest. |
| `pnpm test` | Run the runner's Vitest suite. |

`pnpm probe` is an internal maintainer diagnostic tied to repository-specific
test resource UUIDs. It is not a portable connectivity check or part of the
supported public CLI.

### Panel options

```sh
pnpm panel -- --port 5170
```

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--port <number>` | No | `5170` | Port for the local control panel. |

### Preview options

`pnpm start` and `pnpm dev` accept the same options:

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--checkout <path>` | No | Saved `exploreCheckoutDir` | Checkout created by `retool clone`; used for both app source and resources. |
| `--app <path>` | No | The sole app under the checkout | Absolute app path or path relative to the checkout. |
| `--explore-checkout <path>` | No | — | Backward-compatible alias for `--checkout`. |
| `--port <number>` | No | `5174` | Port for the app preview. |
| `--environment <name>` | No | `staging` | Retool environment: `staging` or `production`. |
| `--writes` | No | Off | Permit mutating resource calls. |
| `--branch <name>` | No | — | Validate that `--app` belongs to this existing worktree branch. |

Examples:

```sh
# One Retool CLI checkout, with staging and read-only as defaults.
pnpm start -- --checkout "/absolute/path/to/retool-app"

# Restart the backend automatically when files change.
pnpm dev -- --checkout "/absolute/path/to/retool-app"

# Use production resources in read-only mode.
pnpm start -- \
  --checkout "/absolute/path/to/retool-app" \
  --environment production

# Explicitly allow writes against staging and validate the branch.
pnpm start -- \
  --app "/absolute/path/to/apps-v2/Group/App" \
  --branch "feature/report" \
  --environment staging \
  --writes

# If a checkout contains multiple apps, choose one explicitly.
pnpm start -- --checkout "/absolute/path/to/checkout" --app "Operations/Report App"
```

The CLI checkout is resolved from `--checkout`, the legacy
`--explore-checkout`, then saved `exploreCheckoutDir`. Preview startup exits with status `1` for invalid
configuration, a missing app, authorization failures, or missing generated resources.

## Develop, validate, and push

The runner handles the local interactive preview. CLI app cards can pull their
checkout or perform an explicitly confirmed preview push; the equivalent
terminal flow is:

```sh
cd /absolute/path/to/retool-app
retool pull

# Edit while the runner is open, then validate as often as needed.
retool check

# The final network-changing step is always explicit.
retool push --wait -m "Finish report filters"
```

`retool push` validates locally before sending changes and creates a Retool
preview build. The runner intentionally has no `retool publish` endpoint or UI;
live publishing must be handled separately by you or your development agent.
Git app cards intentionally have no Retool pull or preview-push actions. Commit
and push those source changes through Git, then use the organization's normal
protected-app release flow.

## Protected Git sources and worktrees

The Git source tab scans the configured Apps as Code repository. The panel
discovers worktrees through `git worktree list`; it does not infer a branch from
a directory name, create worktrees, check out branches, pull, reset, commit, or
push files behind your back.

Create the task worktree with Git or your coding agent first, then select that
same path in the panel. The panel shows its path, branch, commit, and local
modification state. If the path or branch changes after selection, startup fails
instead of silently attaching to different code.

Each worktree gets an independent runner process and port, so several branches
can be previewed concurrently. From the CLI, pass the app path inside the target
worktree. `--branch <name>` validates that existing worktree; it does not create
or switch one. At preview startup, the runner reads the app UUID and selects
only the CLI checkout with that same UUID. If no match exists, the panel asks
you to clone that app under **Settings → CLI checkouts** rather than borrowing
another app's generated resources.

## Environments and write mode

`--environment` accepts `staging` or `production` and defaults to `staging`.
The runner passes the selected value to Retool MCP as `environmentName` for
every non-local resource call.

Before opening a preview port, the runner asks Retool to resolve all required
non-local resources in that environment without executing a query. Startup
stops if a resource cannot be resolved, and the panel reports the environment
and missing resource names. The runner never falls back from staging to
production.

An already-running app is not silently reused with a different environment or
write mode. Stop it before changing either setting. Private local OpenAPI
resources use their configured local base URL instead of the Retool environment.

## Typecheck an app

Typecheck a cloned app directly without starting a preview:

```sh
pnpm typecheck -- --app "/absolute/path/to/retool-app"
```

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--app <app>` | Yes | — | Absolute app path, or a path relative to `--checkout`. |
| `--checkout <path>` | No | Path saved by the panel | Retool CLI checkout used to resolve a relative app path. |
| `--branch <name>` | No | — | Enable optional validation against an existing Git worktree. |
| `--repo <path>` | No | Path saved by the panel | Legacy alias used with `--branch`. |
| `--json` | No | Off | Emit one structured JSON result instead of text diagnostics. |
| `--help`, `-h` | No | — | Print usage and exit successfully. |

The command checks the app's `frontend/` and `backend/` files without writing
generated hooks, resource declarations, configuration, or dependencies into the
checkout. Diagnostics use `file:line:column` locations, and the process exits
`0` when clean or `1` for type or configuration errors.

For structured output:

```sh
pnpm typecheck -- \
  --branch "feature/report" \
  --app "Operations/Report App" \
  --json
```

The JSON result contains `ok`, `appDir`, `branch`, `worktreePath`, error and
warning counts, and diagnostics with file, line, column, TypeScript code,
category, and message. Configuration failures return `{ "ok": false, "error":
"..." }`. Exit status is `0` when the app is clean and `1` for type errors,
invalid arguments, or target-resolution failures.

### Coding agents and LLMs

The typecheck command is designed for automated edit-check loops. A coding
agent or LLM can edit the selected worktree, run:

```sh
pnpm typecheck -- \
  --repo "/path/to/apps-repo" \
  --branch "feature/report" \
  --app "Operations/Report App" \
  --json
```

and use the structured diagnostics to locate and repair errors before running
the app. Repeating the command is deterministic for the same worktree state.
It does not switch branches, start a preview, call application resources, or
write generated files into the app repository.

## Test an Apps as Code app

An app can keep ordinary Vitest files in its own directory and run them with
the Vitest installation already provided by this runner:

```sh
pnpm exec vitest run --root "/absolute/path/to/apps-v2/Group/App"
```

The app does not need to declare or install its own Vitest dependency. The
`--root` path makes Vitest discover the app's test files and resolve their
imports against that app's frontend and backend source.

This command runs ordinary local tests. It does not start an app preview,
connect to Retool, or inject resource globals such as database and REST
clients. Keep these tests focused on pure functions and adapters, or provide
explicit local mocks for external dependencies. Use the preview runner when a
test needs authenticated Retool resources.

`pnpm test` is different: it runs this runner repository's own test suite.

## Reloading behavior

- Frontend changes in `App.tsx`, `components/`, `lib/`, and CSS hot-reload
  through Vite without restarting the preview.
- App backend changes under `backend/**/*.ts` and changes to the runner's own
  `src/**` restart automatically under `pnpm dev`.
- Under `pnpm start`, backend changes require a manual restart.

## Authentication and local data

Authenticate with `retool auth login`; the Retool CLI owns and refreshes its
credentials. The active preview does not read this runner's legacy MCP cache.
The following local data is excluded from Git by this repository:

- `.mcp-auth/` — legacy, currently inactive MCP credentials.
- `config.json` — the saved CLI parent, Git repository, current user, MCP URL,
  and most recent CLI checkout.
- `logs/` — resource query history.
- `.local-resources/` — private OpenAPI definitions and local base URLs.

Do not copy these files into commits, issue reports, or support messages without
reviewing them for credentials and sensitive application data.

## Local REST resources

Retool MCP cannot execute a plain `restapi` resource that contains only a base
URL. The runner can execute it locally when you provide a private OpenAPI
definition keyed by the Retool resource UUID. A configured local UUID takes
precedence over MCP; resources without a local entry continue using MCP.

Create a private local registry from the fake examples:

```sh
cp -R resources.example .local-resources
```

Replace every example value locally. `.local-resources/` is ignored by Git.
Its `resources.json` maps each Retool UUID to an app binding, OpenAPI spec path,
and HTTPS base URL. The base URL must match an origin in the OpenAPI `servers`
list, and requests must match a documented method and path.

The registry is shared across apps and branches, but a preview loads only the
entries referenced by its selected app manifest. The control panel can inspect,
validate, and atomically update a configured private spec. Restart running
previews after saving a spec so they load the updated policy.

Apps keep their Retool-facing resource interface:

```ts
await exampleUpload.query({
  method: 'POST',
  path: uploadUrl.pathname + uploadUrl.search,
  body: fileBuffer,
})
```

`GET`, `HEAD`, and `OPTIONS` work in read-only mode. `POST`, `PUT`, `PATCH`, and
`DELETE` require `--writes`. Redirects are not followed, and logs omit request
bodies, authorization headers, and signed query values.

## Simulated users

The panel's **Emulated current user** editor controls the identity exposed by
both `useCurrentUser()` and backend `req.user`. Set a synthetic or real-looking
ID, email, name, metadata, and group memberships, then reload an open preview.

Opening the editor loads the Retool group directory through the MCP's read-only
`retool_list_groups` tool so memberships can use the org's real group IDs and
names. This is metadata discovery only: app SQL, REST, Fleet, and Slack calls
remain exclusively on `retool resource explore`, with no MCP execution fallback.
The group lookup uses the MCP OAuth cache and may open the one-time browser flow
if no token is cached. Configure the metadata endpoint and authorize it from
**Settings → Retool MCP metadata connection**.

When no MCP endpoint has been configured, the panel synchronizes the emulated
user's name and email from `retool whoami --json`. Group membership is then
edited and stored locally; opening the user editor does not attempt an MCP call.

## Query history

Every remote resource execution is appended to a daily JSON Lines file at
`logs/queries-YYYY-MM-DD.jsonl`. Entries include the resource, exact SQL or
resource code (including any serialized positional parameters), success or
error state, row count, and duration. The directory is ignored by Git, but its
contents may be sensitive.

## How it works

1. Vite serves the app's real `frontend/App.tsx` through the `@app` alias.
2. The runner provides Retool-generated backend hooks as in-memory Vite virtual
   modules that post to `/rpc/:endpoint`.
3. The RPC route executes the app's own `backend/<group>/<endpoint>.ts` locally.
4. Resource globals declared by that endpoint are injected at runtime.
5. Every remote resource call runs through `retool resource explore`, using
   the credentials and generated bindings from the configured CLI checkout.
   There is no MCP execution fallback.
6. Calls started together by one RPC request (for example, calls inside the
   same `Promise.all`) are coalesced into one CLI invocation. Calls separated
   by an `await` remain separate because the later code depends on the earlier
   result. Locally verified reads may share Fleet's CLI classification override;
   unclassified REST operations remain isolated so read-only gating is preserved.

## Programmatic live SQL tests

Live SQL checks are a separate, explicit Vitest project. Retool CLI only
executes the SQL and returns rows; assertions remain ordinary Vitest assertions. The
default `pnpm test` command never discovers files under `tests/live/`.

Sign in with `retool auth login`, then use a checkout created by `retool clone`.
The binding name comes from `backend/resources/*.d.ts` in that checkout; no
resource UUID is required:

```sh
RETOOL_CLI_CHECKOUT=/absolute/path/to/retool-checkout \
LIVE_SQL_RESOURCE_BINDING=databricks \
LIVE_SQL_ENVIRONMENT=staging \
pnpm test:live
```

Apps can import the same helper through the workspace package and keep their
own live assertions beside their SQL builders:

```ts
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createCliSqlRunner, type LiveSqlRunner } from 'local-mcp-runner/live-sql'

let live: LiveSqlRunner
beforeAll(async () => {
  live = await createCliSqlRunner({
    resources: { databricks: 'databricks' },
    checkoutDir: process.env.RETOOL_CLI_CHECKOUT!,
    environmentName: 'staging',
  })
})
afterAll(() => live.close())

it('keeps the attributed total within two percent of the source total', async () => {
  const rows = await live.runSql<{ attributed: number; source: number }>('databricks', buildLeadAttributionSql())
  const { attributed, source } = rows[0]
  expect(rows.length).toBeGreaterThan(0)
  expect(Math.abs(attributed - source) / Math.abs(source)).toBeLessThanOrEqual(0.02)
})
```

`createCliSqlRunner` accepts positional SQL parameters and rejects obvious
write statements before they reach Retool. The CLI is also invoked without
`--allow-mutative`. The checkout owns resource resolution and CLI credentials,
so agents do not need MCP resource IDs or the runner's OAuth cache.

For live checks, gate the selected Retool environment against a value returned
by the database itself. Merely passing `environmentName: 'staging'` proves what
was requested, not where the resource ultimately connected. A dedicated
single-row environment metadata table is strongest; a distinct database name
is a useful fallback:

```ts
const live = await createCliSqlRunner({
  resources: { postgres: 'lakebaseRetoolOltp' },
  checkoutDir: process.env.RETOOL_CLI_CHECKOUT!,
  environmentName: 'staging',
  environmentGate: {
    resource: 'postgres',
    sql: 'SELECT current_database() AS database_name',
    expected: { database_name: 'analytics_staging' },
  },
})
```

The runner executes this read-only query before it becomes available to tests
and fails the suite on zero rows, multiple rows, a query error, or any exact
value mismatch. Live SQL remains read-only regardless of the gate.

## Disposable PostgreSQL tests

For the complete setup, including opt-in Vitest configuration, schema capture,
Databricks fixtures, mixed-resource endpoint tests, environment gates, and
troubleshooting, see the
[integration testing tutorial](docs/INTEGRATION_TESTING_TUTORIAL.md).

Use a fresh Docker-backed PostgreSQL database when a test needs to exercise
destructive SQL or database behavior without touching a Retool environment.
The fixture chooses an unused local port, supports positional parameters,
replays schema and seed SQL on reset, and force-removes its container on close.
Disposable tests have no Retool environment selector or MCP client at all;
that separation is the primary protection against accidental production use.

Capture a schema-only fixture once through an authenticated Retool CLI checkout:

```sh
pnpm schema:postgres -- \
  --binding lakebaseRetoolOltp \
  --checkout /absolute/path/to/retool-checkout \
  --environment staging \
  --out tests/fixtures/postgres-schema.sql
```

The capture reads PostgreSQL catalogs only; it never selects application rows.
Review the generated DDL before committing it. Use explicit, sanitized seed
fixtures for the rows a test needs. The CLI snapshot covers schemas, enums,
sequences, tables, constraints, standalone indexes, and views. For databases
that depend on extensions, functions, triggers, policies, or grants, use a
reviewed `pg_dump --schema-only --no-owner --no-privileges` fixture instead.

```ts
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from 'local-mcp-runner/test-postgres'

let database: DisposablePostgres

beforeAll(async () => {
  database = await createDisposablePostgres({
    schemaSql: readFileSync('tests/fixtures/postgres-schema.sql', 'utf8'),
    seedSql: `INSERT INTO shifts (id, status) VALUES (1, 'open')`,
  })
})
beforeEach(() => database.reset())
afterAll(() => database.close())

it('can exercise destructive behavior locally', async () => {
  await database.runSql('DELETE FROM shifts WHERE id = $1', [1])
  const [{ count }] = await database.runSql<{ count: string }>(
    'SELECT count(*) FROM shifts',
  )
  expect(Number(count)).toBe(0)
})
```

Docker is the only external runtime requirement. The first run pulls
`postgres:16-alpine`; subsequent suites reuse the image but always get a new
container. Give Docker-starting hooks a generous timeout in the app's opt-in
integration-test configuration.

### Mock warehouse and API resources

Keep transactional SQL real while replacing Databricks or external APIs with
strict deterministic mocks. A mock fails immediately for an unexpected query
or call, records every invocation, and `assertSatisfied()` detects expected
calls that never happened. Rules expect one call unless `times` is supplied.

```ts
import {
  createBackendTestRunner,
  createPostgresTestResource,
  createSqlResourceMock,
} from 'local-mcp-runner/test-resources'

it('builds a report using local writes and mocked warehouse data', async () => {
  const databricks = createSqlResourceMock([{
    name: 'utilization facts',
    match: /FROM analytics\.shift_utilization/,
    params: ['lhr'],
    rows: [{ shift_id: 101, utilized_minutes: 420 }],
  }])
  const runner = createBackendTestRunner({
    appDir: '/absolute/path/to/app',
    globals: {
      lakebaseRetoolOltp: createPostgresTestResource(database),
      databricks: databricks.resource,
    },
    user: { email: 'integration-test@example.test' },
  })

  try {
    const result = await runner.run('publishShiftReport', { site: 'lhr' })
    expect(result).toMatchObject({ published: true })
    databricks.assertSatisfied()
  } finally {
    runner.close()
  }
})
```

`createRestResourceMock` provides the same strict behavior for namespaced calls
such as `slack.chat.postMessage(...)`. These backend integration tests receive
only the globals listed in the test, so no fallback to MCP or a Retool
environment is possible.

Resources are matched using UUIDs from `resourceReferencesByFile`, not display
names, and stay scoped to the endpoint that declared them. If generated Retool
types use different casing from the checked-in app, the runner can expose the
app spelling and retry the generated spelling for a precise undefined-binding
error. Ambiguous aliases fail during startup.

Frontend dependencies required by an app are installed in this runner's
`node_modules`; they are not written into the apps repository. The expected app
entry point is `frontend/App.tsx`, and `orgTheme.css` is optional.

## Compatibility

- SQL resources exposing `.query(sql)` or `.query(sql, params)` are supported.
- OpenAPI-annotated REST resources are supported through a dynamic method proxy.
- Other resource types may require a dedicated shim.
- Very large analytical queries may exceed MCP or upstream gateway limits even
  when smaller calls to the same resource succeed.
- OAuth refresh, write gating, and query-history logging are handled by the
  runner rather than by individual apps.

## Known limitations and issues

- The runner expects an Apps as Code layout with `frontend/App.tsx`, optional
  frontend dependencies, TypeScript files under `backend/**`, and Retool
  resource references in the app manifest.
- SQL resources and OpenAPI-style REST resources are the supported resource
  families. Other Retool resource types may require a dedicated runtime shim.
- A plain Retool `restapi` resource using `rawRequest` runs through
  `retool resource explore`; this requires a valid CLI checkout configured as
  `exploreCheckoutDir` or passed with `--explore-checkout`.
- Read-only mode detects common SQL mutation statements and blocks non-read
  methods for local REST resources. It is a safety layer, not a database or
  network sandbox.
- Typechecking models generated Retool hooks and resource globals virtually. It
  catches TypeScript and integration-shape errors but does not execute queries
  or prove that remote data and permissions are valid.
- Branch-based typechecking requires exactly one registered worktree for the
  requested branch.
- A running preview must be restarted after its private OpenAPI document is
  updated.
- Large analytical calls remain subject to Retool and upstream gateway
  request, response, and timeout limits.
- The runner deliberately does not create worktrees, switch branches, pull,
  reset, commit, or otherwise manage the apps repository.

## Project status

The project is under active development. Interfaces and supported Retool
resource behaviors may change as Apps as Code and MCP evolve.

## License

Copyright 2026 Stackdrop.

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for
attribution and trademark information.
