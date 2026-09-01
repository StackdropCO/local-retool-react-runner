# Retool React Local Runner

Run an existing Retool **Apps as Code** React app on your machine while its
backend queries use your authenticated Retool resources through MCP.

The runner reads the app directly from its Git worktree, serves the frontend
with Vite, and executes its backend endpoints locally. It does not generate
files in, check out, reset, or otherwise modify your apps repository.

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
- **Agent-ready typechecking:** coding agents and LLMs can typecheck one app in
  one exact branch worktree and consume stable JSON diagnostics without starting
  a preview or generating files in the apps repo.
- **App-level test execution:** run an Apps as Code app's local Vitest suite
  through the runner with `--root`, without installing Vitest in the app
  repository.
- **More reliable parallel development:** each worktree preview has its own
  process, port, and Vite cache. The panel displays its branch, commit, dirty
  state, environment, and write mode.
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

- Saves and authorizes a per-user Retool MCP URL.
- Shows MCP connection state and queryable Retool resources.
- Scans an Apps as Code repository and discovers registered Git worktrees.
- Displays exact worktree path, branch, commit, and modification state.
- Selects staging or production and read-only or write-enabled execution per app.
- Confirms production launches and write access explicitly.
- Starts, opens, monitors, and stops independent app previews.
- Shows the active environment and write mode for every running app.
- Reports environment-specific missing resources with direct Retool links.
- Lists, opens, validates, and atomically saves private local OpenAPI documents.

### Retool resources and safety

- Authenticates to Retool through standalone OAuth and refreshes cached tokens.
- Resolves resources by UUID from the app manifest and keeps them scoped to the
  backend endpoint that declared them.
- Supports SQL `.query(sql)` and `.query(sql, params)` interfaces.
- Supports OpenAPI-annotated REST resources through dynamic method proxies.
- Can execute configured private REST resources locally from an OpenAPI policy.
- Defaults to staging and read-only execution; write mode is opt-in.
- Records resource calls, outcomes, failures, row counts, and duration in local
  JSON Lines query history.

### Git and automation

- Uses existing Git worktrees without creating, switching, pulling, or resetting
  branches.
- Validates that previews remain attached to the selected worktree.
- Typechecks an app's frontend and backend against virtual Retool hooks and
  manifest-backed resource globals.
- Produces human-readable diagnostics or stable JSON for scripts, coding agents,
  and LLM repair loops.
- Leaves generated hooks, declarations, configuration, and dependencies out of
  the apps repository.

## Requirements

- Node.js 20 or newer.
- pnpm 11 (`corepack enable` is recommended; this repository pins pnpm 11.5.0).
- Git.
- Access to a Retool organization with MCP enabled.
- A local checkout of your Retool Apps as Code repository.

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

Open [http://localhost:5170](http://localhost:5170), then:

1. Enter your MCP URL, such as `https://<your-org>.retool.com/mcp`.
2. Select **Save URL**, then **Authorize**. Your browser opens for Retool login.
3. Select your local Apps as Code repository and scan it.
4. Choose the registered worktree beside an app.
5. Select the environment and write mode, then run the preview.

The preview opens on its own port and watches the exact files in the selected
worktree. The runner remembers the MCP URL and apps repo directory locally.

> [!WARNING]
> A production preview uses production Retool resources. Read-only mode blocks
> common SQL mutation statements, but it is not a complete sandbox. Enabling
> writes allows calls that can change real data. Query history also records the
> exact SQL or resource code and positional parameters locally; treat those logs
> as potentially sensitive.

## Control panel

The control panel is the easiest way to:

- Configure and authorize an MCP connection.
- Inspect queryable Retool resources.
- Scan an Apps as Code repository.
- Select exact Git worktrees.
- Choose staging or production.
- Start, monitor, and stop app previews.
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
| `pnpm start -- --app <path>` | Run one app until the process is stopped. |
| `pnpm dev -- --app <path>` | Run one app and restart its backend when source files change. |
| `pnpm typecheck -- --branch <name> --app <app>` | Typecheck one app in one registered branch worktree. |
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
| `--app <path>` | Yes | — | Path to a Retool app containing `frontend/App.tsx`; an absolute path is recommended. |
| `--mcp-url <url>` | No | Saved URL, then `RETOOL_MCP_URL` | Retool MCP endpoint. |
| `--port <number>` | No | `5174` | Port for the app preview. |
| `--environment <name>` | No | `staging` | Retool environment: `staging` or `production`. |
| `--writes` | No | Off | Permit mutating resource calls. |
| `--branch <name>` | No | — | Validate that `--app` belongs to this existing worktree branch. |

Examples:

```sh
# Staging and read-only are the defaults.
pnpm start -- --app "/absolute/path/to/apps-v2/Group/App"

# Restart the backend automatically when files change.
pnpm dev -- --app "/absolute/path/to/apps-v2/Group/App"

# Use production resources in read-only mode.
pnpm start -- \
  --app "/absolute/path/to/apps-v2/Group/App" \
  --environment production

# Explicitly allow writes against staging and validate the branch.
pnpm start -- \
  --app "/absolute/path/to/apps-v2/Group/App" \
  --branch "feature/report" \
  --environment staging \
  --writes

# Supply the MCP URL instead of using saved configuration.
pnpm start -- \
  --app "/absolute/path/to/apps-v2/Group/App" \
  --mcp-url "https://<your-org>.retool.com/mcp"
```

The MCP URL is resolved in this order: `--mcp-url`, the value saved through the
panel, then `RETOOL_MCP_URL`. Preview startup exits with status `1` for invalid
configuration, a missing app, authorization failures, or unavailable resources.

## Worktrees and parallel branches

The panel discovers worktrees through `git worktree list`. It does not infer a
branch from a directory name, create worktrees, check out branches, pull, reset,
or switch files behind your back.

Create the task worktree with Git or your coding agent first, then select that
same path in the panel. The panel shows its path, branch, commit, and local
modification state. If the path or branch changes after selection, startup fails
instead of silently attaching to different code.

Each worktree gets an independent runner process and port, so several branches
can be previewed concurrently. From the CLI, pass the app path inside the target
worktree. `--branch <name>` validates that existing worktree; it does not create
or switch one.

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

Typecheck one app in one registered worktree without starting a preview:

```sh
pnpm typecheck -- \
  --branch "feature/report" \
  --app "Operations/Report App"
```

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--branch <name>` | Yes | — | Branch with exactly one registered Git worktree. |
| `--app <app>` | Yes | — | App name below `apps-v2/`, an `apps-v2/...` path, or an absolute path. |
| `--repo <path>` | No | Path saved by the panel | Apps as Code repository used to find worktrees. |
| `--json` | No | Off | Emit one structured JSON result instead of text diagnostics. |
| `--help`, `-h` | No | — | Print usage and exit successfully. |

`--app` may be relative to `apps-v2/`, start with `apps-v2/`, or be an absolute
app path. The apps repo defaults to the path saved in the panel. Override it
with `--repo "/path/to/apps-repo"`.

The named branch must have exactly one registered Git worktree. The command
checks the app's `frontend/` and `backend/` files without checking out a branch
or writing generated hooks, resource declarations, configuration, or
dependencies into the apps repo. Diagnostics use `file:line:column` locations,
and the process exits `0` when clean or `1` for type or configuration errors.

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

On first connection to an MCP URL, a browser window opens for Retool login.
Tokens are cached by host under `.mcp-auth/<host>/` and refreshed automatically.
The following local data is excluded from Git by this repository:

- `.mcp-auth/` — OAuth credentials.
- `config.json` — the saved MCP URL and apps repo path.
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

## Query history

Every MCP `execute_resource_ts` call is appended to a daily JSON Lines file at
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
5. Each non-local global forwards its call to `retool_execute_resource_ts`
   through an authenticated MCP client.

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
- A plain Retool `restapi` resource with only a base URL cannot run through MCP;
  configure it as a private local OpenAPI resource instead.
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
- Large analytical calls remain subject to Retool MCP and upstream gateway
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
