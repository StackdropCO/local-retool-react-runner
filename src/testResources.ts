import type { QueryResultRow } from 'pg'
import type { DisposablePostgres } from './disposablePostgres.js'
import { createRunner, type Runner } from './endpointRunner.js'

export type SqlMockCall = {
  sql: string
  params?: unknown[]
}

export type SqlMockRule<T extends QueryResultRow = QueryResultRow> = {
  name?: string
  match: string | RegExp | ((call: SqlMockCall) => boolean)
  params?: unknown[]
  rows: T[] | ((call: SqlMockCall) => T[] | Promise<T[]>)
  times?: number
}

export type RestMockCall = {
  path: string
  args: unknown[]
}

export type RestMockRule = {
  name?: string
  path: string
  args?: unknown[]
  result: unknown | ((call: RestMockCall) => unknown | Promise<unknown>)
  times?: number
}

export type ResourceMock<T> = {
  resource: T
  readonly calls: readonly unknown[]
  assertSatisfied(): void
}

export type BackendTestRunner = Runner & { close(): void }

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim()
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const copy = <T>(value: T): T => structuredClone(value)

function expectedCalls(times?: number): number {
  if (times === undefined) return 1
  if (!Number.isInteger(times) || times < 1) throw new Error('Mock rule times must be a positive integer')
  return times
}

function ruleLabel(rule: { name?: string }, index: number): string {
  return rule.name ? `"${rule.name}"` : `#${index + 1}`
}

/** Strict Databricks/SQL-resource mock. Every call must match an unused rule. */
export function createSqlResourceMock<T extends QueryResultRow = QueryResultRow>(
  rules: SqlMockRule<T>[],
): ResourceMock<{ query(sql: string, params?: unknown[]): Promise<{ data: T[] }> }> {
  const calls: SqlMockCall[] = []
  const counts = rules.map(() => 0)

  const matches = (rule: SqlMockRule<T>, call: SqlMockCall) => {
    if (rule.params !== undefined && !same(rule.params, call.params)) return false
    if (typeof rule.match === 'string') return normalizeSql(rule.match) === normalizeSql(call.sql)
    if (rule.match instanceof RegExp) {
      rule.match.lastIndex = 0
      return rule.match.test(call.sql)
    }
    return rule.match(call)
  }

  return {
    calls,
    resource: {
      async query(sql, params) {
        if (params !== undefined && !Array.isArray(params)) throw new Error('SQL mock parameters must be an array')
        const call = { sql, params }
        calls.push(call)
        const index = rules.findIndex((rule, candidate) =>
          counts[candidate] < expectedCalls(rule.times) && matches(rule, call))
        if (index < 0) {
          throw new Error(`Unexpected SQL resource call:\n${sql}\nparams: ${JSON.stringify(params ?? [])}`)
        }
        counts[index] += 1
        const rows = typeof rules[index].rows === 'function'
          ? await rules[index].rows(call)
          : rules[index].rows
        return { data: copy(rows) }
      },
    },
    assertSatisfied() {
      const missing = rules.flatMap((rule, index) => {
        const expected = expectedCalls(rule.times)
        return counts[index] === expected
          ? []
          : [`rule ${ruleLabel(rule, index)} expected ${expected} call(s), received ${counts[index]}`]
      })
      if (missing.length) throw new Error(`Unsatisfied SQL resource mock:\n${missing.join('\n')}`)
    },
  }
}

/** Strict namespaced REST-resource mock, e.g. slack.chat.postMessage(...). */
export function createRestResourceMock(rules: RestMockRule[]): ResourceMock<Record<string, unknown>> {
  const calls: RestMockCall[] = []
  const counts = rules.map(() => 0)
  const makeProxy = (segments: string[]): any => new Proxy(function () {}, {
    get: (_target, property: string | symbol) => {
      if (property === 'then') return undefined
      if (typeof property !== 'string') return undefined
      return makeProxy([...segments, property])
    },
    apply: async (_target, _this, args: unknown[]) => {
      const call = { path: segments.join('.'), args }
      calls.push(call)
      const index = rules.findIndex((rule, candidate) =>
        counts[candidate] < expectedCalls(rule.times) &&
        rule.path === call.path &&
        (rule.args === undefined || same(rule.args, call.args)))
      if (index < 0) {
        throw new Error(`Unexpected REST resource call ${call.path}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`)
      }
      counts[index] += 1
      const result = typeof rules[index].result === 'function'
        ? await rules[index].result(call)
        : rules[index].result
      return copy(result)
    },
  })

  return {
    calls,
    resource: makeProxy([]),
    assertSatisfied() {
      const missing = rules.flatMap((rule, index) => {
        const expected = expectedCalls(rule.times)
        return counts[index] === expected
          ? []
          : [`rule ${ruleLabel(rule, index)} (${rule.path}) expected ${expected} call(s), received ${counts[index]}`]
      })
      if (missing.length) throw new Error(`Unsatisfied REST resource mock:\n${missing.join('\n')}`)
    },
  }
}

/** Give app backend code Retool's `{ data }` shape while querying local Postgres. */
export function createPostgresTestResource(database: DisposablePostgres): {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<{ data: T[] }>
} {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) {
      return { data: await database.runSql<T>(sql, params) }
    },
  }
}

/** Run checked-in backend endpoints with only explicitly supplied test resources. */
export function createBackendTestRunner(options: {
  appDir: string
  globals: Record<string, unknown>
  user?: unknown
}): BackendTestRunner {
  const previous = new Map<string, { existed: boolean; value: unknown }>()
  for (const name of Object.keys(options.globals)) {
    previous.set(name, {
      existed: Object.prototype.hasOwnProperty.call(globalThis, name),
      value: (globalThis as Record<string, unknown>)[name],
    })
  }
  const runner = createRunner(options)
  let closed = false
  return {
    run: runner.run,
    close() {
      if (closed) return
      closed = true
      for (const [name, prior] of previous) {
        if (prior.existed) (globalThis as Record<string, unknown>)[name] = prior.value
        else delete (globalThis as Record<string, unknown>)[name]
      }
    },
  }
}
