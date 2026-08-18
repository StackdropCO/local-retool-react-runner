import { describe, it, expect, vi } from 'vitest'
import { buildGlobals, resolveResources, WriteBlockedError, type ResourceMap } from './resourceGlobals.js'
import type { LocalResourceMap } from './localResourceConfig.js'

const fakeMcp = (ret: unknown = { data: [{ ok: 1 }] }) => ({
  executeResourceTs: vi.fn().mockResolvedValue(ret),
  getResourceBindings: vi.fn(), listResources: vi.fn(), close: vi.fn(),
})

const map: ResourceMap = {
  'db-uuid': { resourceName: 'db-uuid', displayName: 'Databricks', mcpBinding: 'databricks', sourceBindings: ['databricks'], executionBindings: ['databricks'], kind: 'sql' },
  'lb-uuid': { resourceName: 'lb-uuid', displayName: 'Lakebase Retool - OLTP', mcpBinding: 'lakebaseRetoolOltp', sourceBindings: ['lakebaseRetoolOltp'], executionBindings: ['lakebaseRetoolOltp'], kind: 'sql' },
  'ct-uuid': { resourceName: 'ct-uuid', displayName: 'ConnectTeamAPI', mcpBinding: 'connectteamapi', sourceBindings: ['connectteamapi'], executionBindings: ['connectteamapi'], kind: 'rest' },
}

describe('resolveResources', () => {
  it('maps app refs to {resourceName=uuid, binding=variable_name, kind}', async () => {
    const mcp = fakeMcp()
    mcp.getResourceBindings.mockResolvedValue([
      { resource_id: 'db-uuid', variable_name: 'databricks', type: 'databricks' },
      { resource_id: 'ct-uuid', variable_name: 'connectteamapi', type: 'restapi' },
    ])
    const out = await resolveResources(mcp as any, [
      { name: 'db-uuid', displayName: 'Databricks', type: 'databricks' },
      { name: 'ct-uuid', displayName: 'ConnectTeamAPI', type: 'restapi' },
    ])
    expect(out['db-uuid']).toEqual({ resourceName: 'db-uuid', displayName: 'Databricks', mcpBinding: 'databricks', sourceBindings: ['databricks'], executionBindings: ['databricks'], kind: 'sql' })
    expect(out['ct-uuid']).toEqual({ resourceName: 'ct-uuid', displayName: 'ConnectTeamAPI', mcpBinding: 'connectteamapi', sourceBindings: ['connectteamapi'], executionBindings: ['connectteamapi'], kind: 'rest' })
  })

  it('uses the app source casing when the MCP definition generator reports a different spelling', async () => {
    const mcp = fakeMcp({ data: [{ ok: 1 }] })
    mcp.getResourceBindings.mockResolvedValue([
      { resource_id: 'lb-uuid', variable_name: 'lakebaseRetoolOLTP', type: 'databricksLakebase' },
    ])
    const resolved = await resolveResources(
      mcp as any,
      [{ name: 'lb-uuid', displayName: 'Lakebase Retool - OLTP', type: 'databricksLakebase' }],
      ['const rows = await lakebaseRetoolOltp.query("SELECT 1")'],
    )
    const globals: any = buildGlobals(mcp as any, resolved, {
      writes: true,
      endpoint: 'getShiftOptions',
      normalize: (raw) => raw,
    })

    await globals.lakebaseRetoolOltp.query('SELECT 1')

    expect(mcp.executeResourceTs).toHaveBeenCalledWith(
      ['lb-uuid'],
      'return await lakebaseRetoolOltp.query("SELECT 1")',
      undefined,
    )
  })

  it('rejects a source alias that could refer to multiple resource UUIDs', async () => {
    const mcp = fakeMcp()
    mcp.getResourceBindings.mockResolvedValue([
      { resource_id: 'one', variable_name: 'warehouseDb', type: 'postgresql' },
      { resource_id: 'two', variable_name: 'warehousedb', type: 'postgresql' },
    ])

    await expect(resolveResources(
      mcp as any,
      [
        { name: 'one', displayName: 'Warehouse DB One', type: 'postgresql' },
        { name: 'two', displayName: 'Warehouse DB Two', type: 'postgresql' },
      ],
      ['const rows = await warehouseDB.query("SELECT 1")'],
    )).rejects.toThrow(/ambiguous resource binding.*warehouseDB/i)
  })
})

describe('buildGlobals', () => {
  it('always uses a UUID-matched local REST definition instead of MCP', async () => {
    const mcp = fakeMcp()
    mcp.executeResourceTs.mockRejectedValue(new Error('MCP must not execute this UUID'))
    const localResources: LocalResourceMap = {
      'ct-uuid': {
        resourceId: 'ct-uuid',
        binding: 'connectteamapi',
        baseUrl: new URL('https://uploads.example.test'),
        specPath: '/private/upload.openapi.yaml',
        specHash: 'abc123',
        operations: [{
          method: 'POST',
          template: '/upload/{token}',
          pattern: /^\/upload\/[^/]+$/,
          requestContentTypes: ['application/octet-stream'],
        }],
      },
    }
    const globals: any = buildGlobals(mcp as any, map, {
      writes: true,
      endpoint: 'publish',
      normalize: (raw) => raw,
      localResources,
      localFetchImpl: async () => new Response('OK', { status: 200, headers: { 'content-type': 'text/plain' } }),
    })

    await expect(globals.connectteamapi.query({
      method: 'POST',
      path: '/upload/signed-token',
      body: Buffer.from('pdf'),
    })).resolves.toMatchObject({ status: 200, data: 'OK' })
  })

  it('rejects a local binding that is not an alias for the configured UUID', () => {
    const localResources: LocalResourceMap = {
      'ct-uuid': {
        resourceId: 'ct-uuid',
        binding: 'wrongApi',
        baseUrl: new URL('https://uploads.example.test'),
        specPath: '/private/upload.openapi.yaml',
        specHash: 'abc123',
        operations: [{ method: 'GET', template: '/status', pattern: /^\/status$/, requestContentTypes: [] }],
      },
    }

    expect(() => buildGlobals(fakeMcp() as any, map, {
      writes: false,
      endpoint: 'read',
      normalize: (raw) => raw,
      localResources,
    })).toThrow(/wrongApi.*ct-uuid.*source alias/i)
  })

  it('exposes a Slack OpenAPI resource as a namespaced callable proxy', async () => {
    const mcp = fakeMcp({ ok: true })
    mcp.getResourceBindings.mockResolvedValue([
      { resource_id: 'slack-uuid', variable_name: 'slack', type: 'slackopenapi' },
    ])
    const resolved = await resolveResources(mcp as any, [
      { name: 'slack-uuid', displayName: 'Slack', type: 'slackopenapi' },
    ])
    const g: any = buildGlobals(mcp as any, resolved, { writes: true, endpoint: 'publish', normalize: (r) => r })

    await g.slack.chat.postMessage({ channel: 'C123', text: 'Shift report' })

    expect(mcp.executeResourceTs).toHaveBeenCalledWith(
      ['slack-uuid'],
      'return await slack.chat.postMessage({"channel":"C123","text":"Shift report"})',
      undefined,
    )
  })

  it('sql read forwards a query snippet and normalizes the result', async () => {
    const mcp = fakeMcp({ data: [{ ok: 1 }] })
    const g: any = buildGlobals(mcp as any, map, { writes: true, endpoint: 'e', normalize: (r) => r })
    const out = await g.databricks.query('SELECT 1')
    expect(mcp.executeResourceTs).toHaveBeenCalledWith(['db-uuid'], 'return await databricks.query("SELECT 1")', undefined)
    expect(out).toEqual({ data: [{ ok: 1 }] })
  })

  it('forwards SQL positional parameters to the Retool resource hook', async () => {
    const mcp = fakeMcp({ data: [{ ok: 1 }] })
    const g: any = buildGlobals(mcp as any, map, { writes: true, endpoint: 'e', normalize: (r) => r })

    await g.databricks.query('SELECT * FROM t WHERE day = ? AND geo = ?', ['2026-08-18', 'lhr'])

    expect(mcp.executeResourceTs).toHaveBeenCalledWith(
      ['db-uuid'],
      'return await databricks.query("SELECT * FROM t WHERE day = ? AND geo = ?", ["2026-08-18","lhr"])',
      undefined,
    )
  })

  it('blocks a write when writes=false, before calling the MCP', async () => {
    const mcp = fakeMcp()
    const g: any = buildGlobals(mcp as any, map, { writes: false, endpoint: 'e', normalize: (r) => r })
    await expect(g.lakebaseRetoolOltp.query('INSERT INTO t VALUES (1)')).rejects.toBeInstanceOf(WriteBlockedError)
    expect(mcp.executeResourceTs).not.toHaveBeenCalled()
  })

  it('rest proxy forwards a namespaced op call', async () => {
    const mcp = fakeMcp({ data: { shifts: [] } })
    const g: any = buildGlobals(mcp as any, map, { writes: true, endpoint: 'e', normalize: (r) => r })
    await g.connectteamapi.schedulev1.getShifts(123, { limit: 200 })
    expect(mcp.executeResourceTs).toHaveBeenCalledWith(['ct-uuid'], 'return await connectteamapi.schedulev1.getShifts(123, {"limit":200})', undefined)
  })

  it('falls back to the generated binding only when the source binding is absent in the executor', async () => {
    const mcp = fakeMcp()
    mcp.executeResourceTs
      .mockRejectedValueOnce(new Error('appDb is not defined'))
      .mockResolvedValueOnce({ data: [{ ok: 1 }] })
    const resourceMap: ResourceMap = {
      uuid: {
        resourceName: 'uuid',
        displayName: 'App DB',
        mcpBinding: 'appDB',
        sourceBindings: ['appDb', 'appDB'],
        executionBindings: ['appDb', 'appDB'],
        kind: 'sql',
      },
    }
    const globals: any = buildGlobals(mcp as any, resourceMap, { writes: true, endpoint: 'read', normalize: (r) => r })

    await globals.appDb.query('SELECT 1')

    expect(mcp.executeResourceTs).toHaveBeenNthCalledWith(1, ['uuid'], 'return await appDb.query("SELECT 1")', undefined)
    expect(mcp.executeResourceTs).toHaveBeenNthCalledWith(2, ['uuid'], 'return await appDB.query("SELECT 1")', undefined)
  })
})
