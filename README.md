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

## What it gives you

- A local control panel for finding and running Apps as Code projects.
- Live frontend updates and automatic backend restarts during development.
- Authenticated access to the Retool resources declared by each app.
- Explicit staging or production selection, with read-only mode by default.
- Independent previews for multiple Git worktrees and branches.
- App-level TypeScript checking without generating files in the apps repo.
- Optional local execution for private OpenAPI-backed REST resources.

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

## CLI

Run an app directly from a terminal:

```sh
# Staging and read-only are the defaults.
pnpm start -- --app "/absolute/path/to/apps-v2/Group/App"

# Restart the backend automatically when files change.
pnpm dev -- --app "/absolute/path/to/apps-v2/Group/App"

# Use production resources in read-only mode.
pnpm start -- --app "/absolute/path/to/apps-v2/Group/App" --environment production

# Explicitly allow writes against staging.
pnpm start -- --app "/absolute/path/to/apps-v2/Group/App" --environment staging --writes
```

`--app` is required. The MCP URL is read, in order, from `--mcp-url`, the value
saved through the panel, or the `RETOOL_MCP_URL` environment variable. Use
`--port` to change the preview port from its default of `5174`.

To supply the URL explicitly:

```sh
pnpm start -- \
  --app "/absolute/path/to/apps-v2/Group/App" \
  --mcp-url "https://<your-org>.retool.com/mcp"
```

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

## Project status

The project is under active development. Interfaces and supported Retool
resource behaviors may change as Apps as Code and MCP evolve.

## License

Copyright 2026 Stackdrop.

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for
attribution and trademark information.
