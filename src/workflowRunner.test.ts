import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DisposablePostgres } from './disposablePostgres.js'
import { loadWorkflow, planWorkflow, runWorkflow, type WorkflowFixture } from './workflowRunner.js'

function block(id: string, source: string): string {
  return `id: ${id}\n${source.trim()}\n`
}

function workflow(): string {
  const directory = mkdtempSync(join(tmpdir(), 'workflow-runner-'))
  writeFileSync(join(directory, 'workflow.yml'), 'name: Test workflow\nworkflowId: workflow-1\n')
  writeFileSync(join(directory, 'startTrigger.yml'), block('startTrigger', `
type: datasource
subtype: JavascriptQuery
resourceName: JavascriptQuery
template: { query: "return null" }
blockData:
  uuid: start-uuid
  blockType: webhook
  editorType: JavascriptQuery
  incomingOnSuccessEdges: []`))
  writeFileSync(join(directory, 'prepare.yml'), block('prepare', `
type: datasource
subtype: JavascriptQuery
resourceName: JavascriptQuery
template:
  query: "return { route: startTrigger.data.route, value: startTrigger.data.value + 1 }"
blockData:
  uuid: prepare-uuid
  blockType: code
  editorType: JavascriptQuery
  incomingOnSuccessEdges: [start-uuid]`))
  writeFileSync(join(directory, 'choose.yml'), block('choose', `
type: datasource
subtype: JavascriptQuery
resourceName: JavascriptQuery
template:
  query: "if (prepare.data.route === 'sql') executePathAtMostOnce('0'); else executePathAtMostOnce('1')"
blockData:
  uuid: choose-uuid
  blockType: conditional
  editorType: JavascriptQuery
  outgoingPorts:
    - { id: sql-port, name: "0" }
    - { id: rest-port, name: "1" }
  incomingOnSuccessEdges: [prepare-uuid]`))
  writeFileSync(join(directory, 'writeBlock.yml'), block('writeBlock', `
type: datasource
subtype: SqlQueryUnified
resourceName: pg-resource
template:
  query: "INSERT INTO events(value) VALUES ({{ prepare.data.value }}) RETURNING value"
blockData:
  uuid: write-uuid
  blockType: default
  editorType: SqlQueryUnified
  incomingPorts:
    - { blockId: choose-uuid, portId: sql-port }
  incomingOnSuccessEdges: []`))
  writeFileSync(join(directory, 'restBlock.yml'), block('restBlock', `
type: datasource
subtype: RESTQuery
resourceName: rest-resource
template:
  type: GET
  query: /things
blockData:
  uuid: rest-uuid
  blockType: default
  editorType: RESTQuery
  incomingPorts:
    - { blockId: choose-uuid, portId: rest-port }
  incomingOnSuccessEdges: []`))
  writeFileSync(join(directory, 'response.yml'), block('response', `
type: datasource
subtype: JavascriptQuery
resourceName: JavascriptQuery
template: { query: "return null" }
blockData:
  uuid: response-uuid
  blockType: webhookReturn
  editorType: JavascriptQuery
  options:
    status: "201"
    body: "({ ok: true, value: writeBlock.data[0].value })"
  incomingOnSuccessEdges: [write-uuid]`))
  return directory
}

const fixture = (route: string): WorkflowFixture => ({
  version: 1,
  trigger: { route, value: 40 },
  blocks: {
    writeBlock: { result: [{ value: 41 }] },
    restBlock: { result: { data: [{ id: 1 }] } },
  },
})

describe('workflow runner', () => {
  it('builds a no-I/O plan and classifies mutations', () => {
    const plan = planWorkflow(loadWorkflow(workflow()))
    expect(plan.errors).toEqual([])
    expect(plan.blocks.find((item) => item.id === 'writeBlock')).toMatchObject({ operation: 'sql', mutative: true })
    expect(plan.blocks.find((item) => item.id === 'restBlock')).toMatchObject({ operation: 'rest', mutative: false })
    expect(plan.blocks.find((item) => item.id === 'prepare')?.predecessors).toEqual(['startTrigger'])
  })

  it('executes JavaScript and the selected conditional path with strict mocks', async () => {
    const result = await runWorkflow({ workflow: loadWorkflow(workflow()), mode: 'mock', fixture: fixture('sql') })
    expect(result.status).toBe('success')
    expect(result.blocks.map((item) => item.id)).toEqual(['startTrigger', 'prepare', 'choose', 'writeBlock', 'response'])
    expect(result.blocks.find((item) => item.id === 'choose')?.selectedPath).toBe('0')
    expect(result.response).toEqual({ status: 201, body: { ok: true, value: 41 } })
  })

  it('exposes webhook headers separately from the trigger body', async () => {
    const definition = loadWorkflow(workflow())
    const prepare = definition.byId.get('prepare')!
    prepare.template!.query = "return { route: startTrigger.headers['x-test'], value: startTrigger.data.value + 1 }"
    const result = await runWorkflow({
      workflow: definition,
      mode: 'mock',
      fixture: { ...fixture('unused'), headers: { 'x-test': 'sql' } },
    })
    expect(result.status).toBe('success')
    expect(result.blocks.map((item) => item.id)).toContain('writeBlock')
  })

  it('records the rendered request and exposes mocked metadata in mock mode', async () => {
    const definition = loadWorkflow(workflow())
    const restBlock = definition.byId.get('restBlock')!
    restBlock.template!.type = 'DELETE'
    restBlock.template!.query = 'things/{{ prepare.data.value }}'
    const result = await runWorkflow({
      workflow: definition,
      mode: 'mock',
      fixture: { ...fixture('rest'), blocks: { restBlock: { result: {}, metadata: { status: 204 } } } },
    })
    expect(result.status).toBe('success')
    expect(result.blocks.find((item) => item.id === 'restBlock')?.request).toEqual({ method: 'DELETE', path: 'things/41' })
    const sqlRun = await runWorkflow({ workflow: loadWorkflow(workflow()), mode: 'mock', fixture: fixture('sql') })
    expect(sqlRun.blocks.find((item) => item.id === 'writeBlock')?.request).toEqual({ sql: 'INSERT INTO events(value) VALUES (41) RETURNING value' })
  })

  it('fails a mocked block whose template would throw', async () => {
    const definition = loadWorkflow(workflow())
    definition.byId.get('writeBlock')!.template!.query = 'SELECT {{ restBlock.data.missing.field }}'
    const result = await runWorkflow({ workflow: definition, mode: 'mock', fixture: fixture('sql') })
    expect(result.status).toBe('failed')
    expect(result.blocks.at(-1)).toMatchObject({ id: 'writeBlock', status: 'failed' })
  })

  it('fails closed when a resource mock is missing', async () => {
    const missing = fixture('rest')
    delete missing.blocks!.restBlock
    const result = await runWorkflow({ workflow: loadWorkflow(workflow()), mode: 'mock', fixture: missing })
    expect(result.status).toBe('failed')
    expect(result.blocks.at(-1)).toMatchObject({ id: 'restBlock', status: 'failed' })
    expect(result.blocks.at(-1)?.error).toMatch(/No mock result configured/)
  })

  it('routes SQL blocks to the disposable database in docker mode', async () => {
    const runSql = vi.fn().mockResolvedValue([{ value: 41 }])
    const close = vi.fn().mockResolvedValue(undefined)
    const database = {
      containerName: 'test', connectionString: 'postgresql://test', runSql,
      reset: vi.fn(), close,
    } satisfies DisposablePostgres
    const result = await runWorkflow({
      workflow: loadWorkflow(workflow()),
      mode: 'docker',
      fixture: fixture('sql'),
      databaseFactory: async () => database,
    })
    expect(result.status).toBe('success')
    expect(runSql).toHaveBeenCalledWith('INSERT INTO events(value) VALUES (41) RETURNING value')
    expect(close).toHaveBeenCalledOnce()
  })
})
