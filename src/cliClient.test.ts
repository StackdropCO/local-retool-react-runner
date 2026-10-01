import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { connectRetoolCli } from './cliClient.js'

function checkout(): string {
  const directory = mkdtempSync(join(tmpdir(), 'retool-cli-client-'))
  mkdirSync(join(directory, '.retool'))
  writeFileSync(join(directory, '.retool', 'app.json'), '{}')
  writeFileSync(join(directory, '.retool', 'resource-cache.json'), JSON.stringify({
    resources: [{
      name: 'fleet-id', displayName: 'Fleet 360', type: 'restapi', symbols: ['fleet360'],
    }, {
      name: 'db-id', displayName: 'Lakebase', type: 'postgresql', symbols: ['lakebase'],
    }],
  }))
  return directory
}

describe('connectRetoolCli', () => {
  it('resolves UUIDs to generated CLI bindings without MCP', async () => {
    const client = await connectRetoolCli(checkout())
    await expect(client.getResourceBindings(['fleet-id'])).resolves.toEqual([{
      resource_id: 'fleet-id',
      variable_name: 'fleet360',
      display_name: 'Fleet 360',
      type: 'restapi',
    }])
    await expect(client.listResources()).resolves.toEqual([{
      name: 'fleet-id', displayName: 'Fleet 360', type: 'restapi',
    }, {
      name: 'db-id', displayName: 'Lakebase', type: 'postgresql',
    }])
  })

  it('fails when a required resource is absent from the checkout', async () => {
    const client = await connectRetoolCli(checkout())
    await expect(client.executeResourceTs(['missing'], 'return true', 'staging'))
      .rejects.toThrow(/does not declare resource missing/)
  })

  it('coalesces calls started together in one request into one CLI invocation', async () => {
    const explore = vi.fn().mockResolvedValue({
      ran: true,
      data: [
        { ok: true, value: { data: [{ vehicle: 'sd1234' }] } },
        { ok: true, value: { data: [{ post: 42 }] } },
      ],
    })
    const client = await connectRetoolCli(checkout(), { explore })
    const result = await client.batchCalls!(() => Promise.all([
      client.executeResourceTs(
        ['fleet-id'],
        'return await fleet360.rawRequest({"method":"GET","path":"vehicle"})',
        'production',
        { allowMutative: true, safeRead: true },
      ),
      client.executeResourceTs(
        ['db-id'],
        'return await lakebase.query("SELECT 42")',
        'production',
        { safeRead: true },
      ),
    ]))

    expect(result).toEqual([
      { data: [{ vehicle: 'sd1234' }] },
      { data: [{ post: 42 }] },
    ])
    expect(explore).toHaveBeenCalledTimes(1)
    expect(explore).toHaveBeenCalledWith(
      expect.stringContaining('return await Promise.all(['),
      expect.objectContaining({ environmentName: 'production', allowMutative: true }),
    )
    const code = explore.mock.calls[0]![0]
    expect(code).toContain('fleet360.rawRequest')
    expect(code).toContain('lakebase.query')
  })

  it('keeps per-call failures isolated inside a CLI batch', async () => {
    const explore = vi.fn().mockResolvedValue({
      ran: true,
      data: [
        { ok: false, error: 'Fleet unavailable' },
        { ok: true, value: { data: [{ post: 42 }] } },
      ],
    })
    const client = await connectRetoolCli(checkout(), { explore })
    const settled = await client.batchCalls!(() => Promise.allSettled([
      client.executeResourceTs(['fleet-id'], 'return await fleet360.rawRequest({})', 'production'),
      client.executeResourceTs(['db-id'], 'return await lakebase.query("SELECT 42")', 'production'),
    ]))

    expect(settled[0]).toMatchObject({ status: 'rejected', reason: new Error('Fleet unavailable') })
    expect(settled[1]).toEqual({ status: 'fulfilled', value: { data: [{ post: 42 }] } })
  })

  it('does not share a read-only CLI override with an unclassified REST call', async () => {
    const explore = vi.fn().mockImplementation(async (code: string) => ({
      ran: true,
      data: code.includes('Promise.all')
        ? [{ ok: true, value: { data: [] } }]
        : { data: { ok: true } },
    }))
    const client = await connectRetoolCli(checkout(), { explore })
    await client.batchCalls!(() => Promise.all([
      client.executeResourceTs(
        ['fleet-id'],
        'return await fleet360.rawRequest({"method":"GET","path":"vehicle"})',
        'production',
        { allowMutative: true, safeRead: true },
      ),
      client.executeResourceTs(['fleet-id'], 'return await fleet360.deleteVehicle({"id":"one"})', 'production'),
    ]))

    expect(explore).toHaveBeenCalledTimes(2)
    const optionsByCode = explore.mock.calls.map(([code, invocationOptions]) => ({ code, invocationOptions }))
    expect(optionsByCode.find((call) => call.code.includes('rawRequest'))?.invocationOptions)
      .toMatchObject({ allowMutative: true })
    expect(optionsByCode.find((call) => call.code.includes('deleteVehicle'))?.invocationOptions)
      .toMatchObject({ allowMutative: false })
  })
})
