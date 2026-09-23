import { execFile as execFileCallback } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { Client, type ClientConfig, type QueryResultRow } from 'pg'

const execFile = promisify(execFileCallback)

type SqlSource = string | string[]

type PgClient = {
  connect(): Promise<unknown>
  query(sql: string, values?: unknown[]): Promise<{ rows: QueryResultRow[] }>
  end(): Promise<void>
}

type DockerCommand = (args: string[]) => Promise<string>

export type DisposablePostgresOptions = {
  /** SQL applied once when the container starts and again after reset(). */
  schemaSql?: SqlSource
  /** Explicit test fixtures applied after the schema. Never copied automatically from a live database. */
  seedSql?: SqlSource
  image?: string
  startupTimeoutMs?: number
  namePrefix?: string
  /** @internal Dependency injection for unit tests. */
  dockerCommand?: DockerCommand
  /** @internal Dependency injection for unit tests. */
  clientFactory?: (config: ClientConfig) => PgClient
}

export type DisposablePostgres = {
  containerName: string
  connectionString: string
  runSql<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>
  reset(): Promise<void>
  close(): Promise<void>
}

function statements(source?: SqlSource): string[] {
  if (source === undefined) return []
  return (Array.isArray(source) ? source : [source]).map((sql) => sql.trim()).filter(Boolean)
}

function localPort(output: string): number {
  const match = output.trim().match(/:(\d+)$/m)
  const port = Number(match?.[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Docker returned an invalid PostgreSQL port: ${output.trim() || '(empty)'}`)
  }
  return port
}

// reset() must clear whatever the fixture created, not just `public`. Retool
// apps routinely own a named schema (this repo's shift app uses shift_ops and
// logs), and dropping only `public` left their rows in place AND made the
// schema SQL fail on replay with "schema ... already exists" — a reset that
// both leaks state and throws. Drop every non-system schema instead, then
// recreate `public` so a fixture that assumes the default schema still works.
const RESET_SQL = `DO $$
DECLARE target text;
BEGIN
  FOR target IN
    SELECT nspname FROM pg_namespace
     WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND nspname NOT LIKE 'pg_temp%'
       AND nspname NOT LIKE 'pg_toast_temp%'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', target);
  END LOOP;
  EXECUTE 'CREATE SCHEMA public';
END $$;`

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function defaultDockerCommand(args: string[]): Promise<string> {
  const result = await execFile('docker', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  return result.stdout
}

/**
 * Start a fresh PostgreSQL Docker container for a test suite.
 *
 * The database is intentionally disposable: close() force-removes the
 * container, and reset() drops/recreates the public schema before replaying
 * the supplied schema and seed SQL.
 */
export async function createDisposablePostgres(
  options: DisposablePostgresOptions = {},
): Promise<DisposablePostgres> {
  const docker = options.dockerCommand ?? defaultDockerCommand
  const clientFactory = options.clientFactory ?? ((config) => new Client(config))
  const image = options.image ?? 'postgres:16-alpine'
  const password = randomBytes(24).toString('hex')
  const suffix = randomBytes(6).toString('hex')
  const safePrefix = (options.namePrefix ?? 'local-mcp-test').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 40)
  const containerName = `${safePrefix}-${suffix}`
  const schemaSql = statements(options.schemaSql)
  const seedSql = statements(options.seedSql)
  let client: PgClient | null = null
  let started = false
  let closed = false

  const removeContainer = async () => {
    if (!started) return
    await docker(['rm', '--force', containerName]).catch(() => '')
    started = false
  }

  try {
    await docker([
      'run', '--detach', '--rm',
      '--name', containerName,
      '--publish', '127.0.0.1::5432',
      '--env', `POSTGRES_PASSWORD=${password}`,
      '--env', 'POSTGRES_USER=runner',
      '--env', 'POSTGRES_DB=testdb',
      image,
    ])
    started = true

    const port = localPort(await docker(['port', containerName, '5432/tcp']))
    const connectionString = `postgresql://runner:${password}@127.0.0.1:${port}/testdb`
    const deadline = Date.now() + (options.startupTimeoutMs ?? 30_000)
    let lastError: unknown
    while (Date.now() < deadline) {
      const candidate = clientFactory({ connectionString })
      try {
        await candidate.connect()
        client = candidate
        break
      } catch (error) {
        lastError = error
        await candidate.end().catch(() => undefined)
        await delay(150)
      }
    }
    if (!client) {
      throw new Error(`PostgreSQL container did not become ready: ${String((lastError as Error)?.message ?? lastError ?? 'timeout')}`)
    }

    const applyFixture = async () => {
      for (const sql of schemaSql) await client!.query(sql)
      for (const sql of seedSql) await client!.query(sql)
    }
    await applyFixture()

    return {
      containerName,
      connectionString,
      async runSql<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) {
        if (closed || !client) throw new Error('Disposable PostgreSQL environment is closed')
        if (params !== undefined && !Array.isArray(params)) throw new Error('SQL query parameters must be an array')
        return (await client.query(sql, params)).rows as T[]
      },
      async reset() {
        if (closed || !client) throw new Error('Disposable PostgreSQL environment is closed')
        await client.query(RESET_SQL)
        await applyFixture()
      },
      async close() {
        if (closed) return
        closed = true
        const activeClient = client
        client = null
        await activeClient?.end().catch(() => undefined)
        await removeContainer()
      },
    }
  } catch (error) {
    await client?.end().catch(() => undefined)
    await removeContainer()
    throw error
  }
}

export const disposablePostgresInternals = { localPort, statements, RESET_SQL }
