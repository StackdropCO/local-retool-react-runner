import { describe, it, expect, vi } from 'vitest'
import { buildGlobals, resolveResources, WriteBlockedError, type ResourceMap } from './resourceGlobals.js'

const fakeMcp = (ret: unknown = { data: [{ ok: 1 }] }) => ({
  executeResourceTs: vi.fn().mockResolvedValue(ret),
  getResourceBindings: vi.fn(), listResources: vi.fn(), close: vi.fn(),
})

const map: ResourceMap = {
  Databricks: { resourceName: 'db-uuid', binding: 'databricks', kind: 'sql' },
  'Lakebase Retool - OLTP': { resourceName: 'lb-uuid', binding: 'lakebaseRetoolOltp', kind: 'sql' },
  ConnectTeamAPI: { resourceName: 'ct-uuid', binding: 'connectteamapi', kind: 'rest' },
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
    expect(out.Databricks).toEqual({ resourceName: 'db-uuid', binding: 'databricks', kind: 'sql' })
    expect(out.ConnectTeamAPI).toEqual({ resourceName: 'ct-uuid', binding: 'connectteamapi', kind: 'rest' })
  })
})

describe('buildGlobals', () => {
  it('sql read forwards a query snippet and normalizes the result', async () => {
    const mcp = fakeMcp({ data: [{ ok: 1 }] })
    const g: any = buildGlobals(mcp as any, map, { writes: true, endpoint: 'e', normalize: (r) => r })
    const out = await g.databricks.query('SELECT 1')
    expect(mcp.executeResourceTs).toHaveBeenCalledWith(['db-uuid'], 'return await databricks.query("SELECT 1")', undefined)
    expect(out).toEqual({ data: [{ ok: 1 }] })
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
})
