# Tutorial: Safe Integration Tests with Local Postgres and Resource Mocks

This tutorial builds integration tests for a Retool Apps-as-Code backend without
writing to staging or production.

The finished test setup uses:

- a fresh PostgreSQL container for real transactional database behavior;
- a reviewed schema-only fixture captured through Retool MCP;
- small, synthetic seed files owned by the test;
- strict mocks for Databricks and external APIs;
- the app's real checked-in backend endpoint code; and
- ordinary Vitest assertions.

MCP is used only for explicitly requested live reads such as refreshing a
schema fixture. Ordinary integration tests do not connect to MCP and do not
select a Retool environment.

## 1. Understand the three test lanes

Keep these as separate commands and separate files:

| Lane | Resources | Intended use |
| --- | --- | --- |
| Unit | All mocked or pure functions | Fast default tests and PR checks |
| Local integration | Disposable Postgres plus strict mocks | SQL behavior and complete backend endpoints |
| Live checks | Real resources through MCP, read-only and gated | Validate assumptions against changing live data |

The default `pnpm test` command should stay in the unit lane. Docker integration
tests and live MCP checks should always be opt-in.

## 2. Prerequisites

You need:

- Docker Desktop or another working Docker engine;
- Node.js and pnpm;
- this `local-mcp-runner` package available to the app workspace; and
- cached MCP authorization only when capturing a schema or running a live check.

If the app is in another local repository, add this project as a development
dependency using your workspace configuration or a local `link:` dependency.
The imports used below are:

```ts
import { createDisposablePostgres } from 'local-mcp-runner/test-postgres'
import {
  createBackendTestRunner,
  createPostgresTestResource,
  createRestResourceMock,
  createSqlResourceMock,
} from 'local-mcp-runner/test-resources'
```

## 3. Find the resource UUID and binding

Retool records resource references in the app's `package.json`:

```json
{
  "retool": {
    "app": {
      "resourceReferencesByFile": {
        "/backend/shift/publishShiftReport.ts": [
          {
            "name": "11111111-1111-1111-1111-111111111111",
            "displayName": "Lakebase Retool - OLTP",
            "type": "postgresql"
          },
          {
            "name": "22222222-2222-2222-2222-222222222222",
            "displayName": "Databricks",
            "type": "databricks"
          }
        ]
      }
    }
  }
}
```

`name` is the stable resource UUID. The binding is the global identifier used
by backend source, for example:

```ts
await lakebaseRetoolOltp.query(...)
await databricks.query(...)
```

An agent should read both the package manifest and endpoint source instead of
guessing a resource from its display name.

## 4. Capture a PostgreSQL schema fixture

Run schema capture explicitly against the intended Retool environment:

```sh
pnpm schema:postgres -- \
  --resource 11111111-1111-1111-1111-111111111111 \
  --environment staging \
  --out tests/fixtures/postgres-schema.sql
```

The command:

1. requires cached MCP authorization;
2. sends the selected environment name to Retool;
3. performs read-only PostgreSQL catalog queries;
4. does not select application rows; and
5. refuses to overwrite an existing fixture unless `--force` is passed.

Review the resulting SQL before committing it. MCP capture supports schemas,
enums, sequences, tables, constraints, standalone indexes, and views. If the
database relies on extensions, functions, triggers, row-level security,
policies, or grants, use a reviewed schema-only `pg_dump` instead:

If `pg_dump` is installed locally:

```sh
pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL" \
  > tests/fixtures/postgres-schema.sql
```

Or run the matching tool through Docker while passing `PGDATABASE` from the
host environment:

```sh
docker run --rm -e PGDATABASE postgres:16-alpine \
  pg_dump --schema-only --no-owner --no-privileges \
  > tests/fixtures/postgres-schema.sql
```

Never commit credentials or an unreviewed production dump.

## 5. Add synthetic seed data

Create a small fixture containing only the scenario under test:

```sql
-- tests/fixtures/shift-seed.sql
INSERT INTO shifts (id, site, status, starts_at, ends_at)
VALUES
  (101, 'lhr', 'open', '2026-09-23T08:00:00Z', '2026-09-23T16:00:00Z');

INSERT INTO shift_reports (shift_id, status)
VALUES (101, 'draft');
```

Prefer synthetic records with obvious IDs and dates. Do not copy live rows into
the repository merely because they are convenient.

## 6. Create an opt-in Vitest project

Add a dedicated configuration in the app repository:

```ts
// vitest.config.integration.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.integration.test.ts'],
    passWithNoTests: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
```

Add a separate script:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.config.integration.ts"
  }
}
```

Run it explicitly:

```sh
pnpm test:integration
```

Do not add this configuration to the default test discovery pattern.

## 7. Test a SQL builder against real Postgres

Start one database for the file, reset it before each test, and always close it:

```ts
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import {
  createDisposablePostgres,
  type DisposablePostgres,
} from 'local-mcp-runner/test-postgres'
import { buildReopenShiftSql } from '../../backend/shift/sql'

let database: DisposablePostgres

beforeAll(async () => {
  database = await createDisposablePostgres({
    schemaSql: readFileSync('tests/fixtures/postgres-schema.sql', 'utf8'),
    seedSql: readFileSync('tests/fixtures/shift-seed.sql', 'utf8'),
  })
}, 120_000)

beforeEach(() => database.reset())
afterAll(() => database.close())

it('reopens a published shift report', async () => {
  await database.runSql(buildReopenShiftSql(), [101])

  const rows = await database.runSql<{ status: string }>(
    'SELECT status FROM shift_reports WHERE shift_id = $1',
    [101],
  )
  expect(rows).toEqual([{ status: 'draft' }])
})
```

This is a genuine database integration test: PostgreSQL parses and executes the
real SQL, enforces constraints, and applies transactions and mutations.

## 8. Mock Databricks with explicit example rows

Warehouse results are intentionally supplied by the test. The mock adds
Retool's `{ data }` wrapper automatically, so provide only the rows:

```ts
const databricks = createSqlResourceMock([{
  name: 'utilization facts for LHR',
  match: /FROM analytics\.shift_utilization/,
  params: ['lhr'],
  rows: [
    {
      shift_id: 101,
      site: 'lhr',
      utilized_minutes: 420,
      scheduled_minutes: 480,
    },
  ],
}])
```

For larger shapes, use a JSON file:

```json
[
  {
    "shift_id": 101,
    "site": "lhr",
    "utilized_minutes": 420,
    "scheduled_minutes": 480
  }
]
```

```ts
import utilizationRows from '../fixtures/databricks/utilization.json'

const databricks = createSqlResourceMock([{
  match: /FROM analytics\.shift_utilization/,
  rows: utilizationRows,
}])
```

The agent can derive the fixture shape from SQL aliases, TypeScript types, and
the endpoint's property access. When those sources are ambiguous, run a small,
gated staging query once and turn the result into synthetic data. Do not commit
copied production records.

Mocks can calculate rows from parameters:

```ts
const databricks = createSqlResourceMock([{
  match: /WHERE site = \?/,
  params: ['lhr'],
  rows: ({ params }) => [{ site: params?.[0], total: 12 }],
}])
```

Mocks are strict. An unexpected query fails immediately. Each rule expects one
call by default; set `times` when repetition is intentional. Call
`assertSatisfied()` to detect planned queries that the endpoint never made.

## 9. Run a complete backend endpoint with mixed resources

Use local Postgres and mocked Databricks in the same endpoint test:

```ts
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import {
  createBackendTestRunner,
  createPostgresTestResource,
  createSqlResourceMock,
} from 'local-mcp-runner/test-resources'

it('publishes a report from warehouse facts', async () => {
  const databricks = createSqlResourceMock([{
    name: 'shift facts',
    match: /FROM analytics\.shift_utilization/,
    rows: [{ shift_id: 101, utilized_minutes: 420 }],
  }])

  const runner = createBackendTestRunner({
    appDir: resolve('apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard'),
    globals: {
      lakebaseRetoolOltp: createPostgresTestResource(database),
      databricks: databricks.resource,
    },
    user: {
      id: 9001,
      email: 'integration-test@example.test',
      groups: [{ id: 1, name: 'Shift Utilisation Access' }],
    },
  })

  try {
    const result = await runner.run('publishShiftReport', { shiftId: 101 })
    expect(result).toMatchObject({ published: true })

    const reports = await database.runSql<{ status: string }>(
      'SELECT status FROM shift_reports WHERE shift_id = $1',
      [101],
    )
    expect(reports).toEqual([{ status: 'published' }])
    databricks.assertSatisfied()
  } finally {
    runner.close()
  }
})
```

The endpoint imports and executes from the checked-in app source. It sees only
the globals supplied by the test. There is no MCP fallback.

Because backend resources are injected as globals, do not use `it.concurrent`
for endpoint tests in the same worker.

## 10. Mock namespaced REST resources

Use `createRestResourceMock` for APIs such as Slack:

```ts
const slack = createRestResourceMock([{
  name: 'publish notification',
  path: 'chat.postMessage',
  args: [{ channel: 'C123', text: 'Shift 101 published' }],
  result: { ok: true, ts: '123.456' },
}])

const runner = createBackendTestRunner({
  appDir,
  globals: {
    slack: slack.resource,
    lakebaseRetoolOltp: createPostgresTestResource(database),
  },
})

await runner.run('notifyShiftPublished', { shiftId: 101 })
slack.assertSatisfied()
```

Nested paths are supported, and unexpected paths or arguments fail.

## 11. Gate the separate live-test lane

Local integration tests need no environment gate because they have no MCP
connection. Live tests must verify the actual database identity before running:

```ts
const live = await createLiveSqlRunner({
  resources: { postgres: process.env.LIVE_SQL_RESOURCE_ID! },
  environmentName: 'staging',
  environmentGate: {
    resource: 'postgres',
    sql: 'SELECT environment, tenant FROM environment_metadata LIMIT 1',
    expected: {
      environment: 'staging',
      tenant: 'ops',
    },
  },
})
```

The runner fails before returning if the gate query errors, returns anything
other than one row, or contains a mismatched value. A metadata table is
stronger than checking only `current_database()` because database names can be
reused or misconfigured.

Live SQL is always read-only, even after a gate passes.

## 12. Recommended agent workflow

When asking an agent to add an integration test, give it the app and behavior,
not hand-written resource plumbing. A good request is:

> Add an opt-in integration test for `publishShiftReport`. Use disposable
> Postgres for Lakebase, mock Databricks, derive the resource UUIDs and bindings
> from the app manifest and backend source, create minimal synthetic fixtures,
> assert the database write and returned result, and do not call MCP during the
> test run.

The agent should then:

1. inspect `resourceReferencesByFile` for UUIDs and endpoint scope;
2. inspect backend source for binding names and result shapes;
3. reuse the checked-in schema fixture, refreshing it only when authorized;
4. add the smallest seed and warehouse fixtures that prove the behavior;
5. make every non-Postgres resource explicit;
6. run only the opt-in integration project; and
7. confirm all Docker containers were removed.

## 13. Safety checklist

Before accepting an integration test, verify:

- [ ] The test command is separate from the default unit suite.
- [ ] The test imports `test-postgres` and/or `test-resources`, not `live-sql`.
- [ ] Seed rows are synthetic and reviewable.
- [ ] Every warehouse/API call has an explicit strict mock.
- [ ] `assertSatisfied()` is called for mocks whose interaction matters.
- [ ] The database is reset between tests.
- [ ] The database and backend runner are closed in teardown/finally blocks.
- [ ] Endpoint tests are not concurrent in the same worker.
- [ ] Any schema refresh names an environment explicitly.
- [ ] Any truly live test is read-only and has a database-level environment gate.

## 14. Troubleshooting

### Docker takes longer than the hook timeout

The first run may pull `postgres:16-alpine`. Set `hookTimeout: 120_000` in the
integration Vitest configuration.

### `Unexpected SQL resource call`

The endpoint issued SQL that no Databricks rule matched. Read the SQL and
parameters in the error, then either correct the endpoint or add an intentional
rule. Avoid making the mock accept every query.

### `Unsatisfied SQL resource mock`

A planned warehouse query did not occur. This often catches an early return,
incorrect branch, or changed endpoint behavior.

### PostgreSQL reports a missing extension, function, trigger, or policy

The MCP schema snapshot covers common relational objects, not the entire
PostgreSQL catalog. Replace it with a reviewed `pg_dump --schema-only` fixture
or add the required test-safe object explicitly.

### The endpoint says a global resource is undefined

Compare the backend identifier with `globals` passed to
`createBackendTestRunner`. Use the checked-in source spelling exactly.

### A container remains after an interrupted test

Normal teardown force-removes containers. After a hard process termination,
list containers whose names start with `local-mcp-test-`, inspect the exact
targets, and remove only those disposable containers.
