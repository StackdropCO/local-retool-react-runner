import { describe, expect, it, vi } from 'vitest'
import { createDisposablePostgres, disposablePostgresInternals } from './disposablePostgres.js'

describe('disposable PostgreSQL helpers', () => {
  it('parses Docker mapped ports without assuming a fixed host port', () => {
    expect(disposablePostgresInternals.localPort('127.0.0.1:49167\n')).toBe(49167)
    expect(disposablePostgresInternals.localPort('[::1]:49168\n')).toBe(49168)
    expect(() => disposablePostgresInternals.localPort('')).toThrow(/invalid PostgreSQL port/)
  })

  it('starts, seeds, resets, queries, and removes an isolated container', async () => {
    const docker = vi.fn(async (args: string[]) => args[0] === 'port' ? '127.0.0.1:49167\n' : '')
    const query = vi.fn(async (sql: string) => ({ rows: sql === 'SELECT * FROM widgets' ? [{ id: 1 }] : [] }))
    const connect = vi.fn(async () => undefined)
    const end = vi.fn(async () => undefined)

    const database = await createDisposablePostgres({
      schemaSql: ['CREATE TABLE widgets (id integer PRIMARY KEY)', '  '],
      seedSql: 'INSERT INTO widgets VALUES (1)',
      dockerCommand: docker,
      clientFactory: () => ({ connect, query, end }),
    })

    await expect(database.runSql<{ id: number }>('SELECT * FROM widgets')).resolves.toEqual([{ id: 1 }])
    await database.reset()
    await database.close()
    await database.close()

    expect(docker.mock.calls[0][0]).toEqual(expect.arrayContaining(['run', '--rm', '--publish', '127.0.0.1::5432']))
    expect(docker).toHaveBeenCalledWith(['port', database.containerName, '5432/tcp'])
    expect(docker).toHaveBeenCalledWith(['rm', '--force', database.containerName])
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'CREATE TABLE widgets (id integer PRIMARY KEY)',
      'INSERT INTO widgets VALUES (1)',
      'SELECT * FROM widgets',
      disposablePostgresInternals.RESET_SQL,
      'CREATE TABLE widgets (id integer PRIMARY KEY)',
      'INSERT INTO widgets VALUES (1)',
    ])
    expect(end).toHaveBeenCalledOnce()
  })

  it('resets every non-system schema, not just public', () => {
    const sql = disposablePostgresInternals.RESET_SQL
    expect(sql).toMatch(/FROM pg_namespace/)
    expect(sql).toMatch(/DROP SCHEMA %I CASCADE/)
    expect(sql).toMatch(/CREATE SCHEMA public/)
    for (const system of ['pg_catalog', 'information_schema', 'pg_toast']) {
      expect(sql).toContain(system)
    }
  })

  it('removes the container when fixture setup fails', async () => {
    const docker = vi.fn(async (args: string[]) => args[0] === 'port' ? '127.0.0.1:49167\n' : '')
    const query = vi.fn(async () => { throw new Error('bad schema') })
    const end = vi.fn(async () => undefined)

    await expect(createDisposablePostgres({
      schemaSql: 'not sql',
      dockerCommand: docker,
      clientFactory: () => ({ connect: async () => undefined, query, end }),
    })).rejects.toThrow('bad schema')

    expect(docker.mock.calls.at(-1)?.[0].slice(0, 2)).toEqual(['rm', '--force'])
    expect(end).toHaveBeenCalledOnce()
  })
})
