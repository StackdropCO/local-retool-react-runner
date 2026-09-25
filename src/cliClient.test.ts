import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectRetoolCli } from './cliClient.js'

function checkout(): string {
  const directory = mkdtempSync(join(tmpdir(), 'retool-cli-client-'))
  mkdirSync(join(directory, '.retool'))
  writeFileSync(join(directory, '.retool', 'app.json'), '{}')
  writeFileSync(join(directory, '.retool', 'resource-cache.json'), JSON.stringify({
    resources: [{
      name: 'fleet-id', displayName: 'Fleet 360', type: 'restapi', symbols: ['fleet360'],
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
    }])
  })

  it('fails when a required resource is absent from the checkout', async () => {
    const client = await connectRetoolCli(checkout())
    await expect(client.executeResourceTs(['missing'], 'return true', 'staging'))
      .rejects.toThrow(/does not declare resource missing/)
  })
})
