import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBackendTestRunner, createPostgresTestResource, createRestResourceMock, createSqlResourceMock } from './testResources.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('test resource mocks', () => {
  it('returns cloned Databricks rows and records calls', async () => {
    const databricks = createSqlResourceMock([{ name: 'shift totals', match: /FROM shift_totals/, params: ['lhr'], rows: [{ total: 42 }] }])

    const first = await databricks.resource.query('SELECT total FROM shift_totals WHERE site = ?', ['lhr'])
    first.data[0].total = 0

    expect(databricks.calls).toEqual([{ sql: 'SELECT total FROM shift_totals WHERE site = ?', params: ['lhr'] }])
    expect(() => databricks.assertSatisfied()).not.toThrow()
    expect(await createSqlResourceMock([{ match: 'SELECT 1', rows: [{ value: 1 }] }]).resource.query('  SELECT   1 '))
      .toEqual({ data: [{ value: 1 }] })
  })

  it('fails immediately on an unplanned warehouse query and reports unused rules', async () => {
    const databricks = createSqlResourceMock([{ name: 'expected report', match: 'SELECT * FROM report', rows: [] }])

    await expect(databricks.resource.query('SELECT * FROM something_else')).rejects.toThrow(/Unexpected SQL resource call/)
    expect(() => databricks.assertSatisfied()).toThrow(/expected report.*expected 1 call.*received 0/)
  })

  it('mocks namespaced REST calls strictly', async () => {
    const slack = createRestResourceMock([{
      path: 'chat.postMessage',
      args: [{ channel: 'C1', text: 'ready' }],
      result: { ok: true, ts: '123' },
    }])

    await expect((slack.resource as any).chat.postMessage({ channel: 'C1', text: 'ready' }))
      .resolves.toEqual({ ok: true, ts: '123' })
    expect(slack.calls).toEqual([{ path: 'chat.postMessage', args: [{ channel: 'C1', text: 'ready' }] }])
    expect(() => slack.assertSatisfied()).not.toThrow()
  })

  it('adapts disposable PostgreSQL to the Retool query shape', async () => {
    const database = { runSql: async () => [{ id: 1 }] }
    const resource = createPostgresTestResource(database as any)
    await expect(resource.query('SELECT * FROM widgets')).resolves.toEqual({ data: [{ id: 1 }] })
  })

  it('runs a backend endpoint with explicit resources and restores globals', async () => {
    const prior = (globalThis as any).fakeResource
    const runner = createBackendTestRunner({
      appDir: join(here, 'fixtures'),
      globals: { fakeResource: { query: async () => ({ data: [{ local: true }] }) } },
      user: { email: 'integration@example.test' },
    })

    await expect(runner.run('echoEndpoint', { test: true })).resolves.toMatchObject({
      params: { test: true },
      user: { email: 'integration@example.test' },
      probe: { data: [{ local: true }] },
    })
    runner.close()
    expect((globalThis as any).fakeResource).toBe(prior)
  })
})
