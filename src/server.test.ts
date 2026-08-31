import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { appViteCacheDir, assertResourcesAvailableInEnvironment, discoverEndpoints } from './server.js'
import type { McpClient } from './mcpClient.js'
import type { ResourceMap } from './resourceGlobals.js'

const APP = process.env.RETOOL_TEST_APP || ''

describe.skipIf(!APP || !existsSync(join(APP, 'backend')))('discoverEndpoints (set RETOOL_TEST_APP to run)', () => {
  it('finds default-export endpoints and excludes non-endpoint helpers', () => {
    const eps = discoverEndpoints(APP)
    expect(eps.length).toBeGreaterThan(0)
    // shared helper modules (no default export) must be excluded
    expect(eps).not.toContain('shared')
  })
})

const resources: ResourceMap = {
  databaseId: {
    resourceName: 'databaseId',
    displayName: 'Databricks',
    mcpBinding: 'databricks',
    sourceBindings: ['databricks'],
    executionBindings: ['databricks'],
    kind: 'sql',
  },
  localUploadId: {
    resourceName: 'localUploadId',
    displayName: 'Slack file upload',
    mcpBinding: 'slackFileUpload',
    sourceBindings: ['slackFileUpload'],
    executionBindings: ['slackFileUpload'],
    kind: 'rest',
  },
}

function environmentCheckingMcp(): McpClient {
  return {
    async executeResourceTs(resourceNames, _code, environmentName) {
      if (environmentName !== 'staging') throw new Error(`unexpected environment: ${environmentName}`)
      if (resourceNames.includes('localUploadId')) throw new Error('local resource was sent to Retool')
      if (resourceNames.includes('databaseId')) {
        throw new Error('No resource named databaseId exists in requested environment')
      }
      return true
    },
    async getResourceBindings() { return [] },
    async listResources() { return [] },
    async close() {},
  }
}

describe('Retool environment startup validation', () => {
  it('rejects startup with the selected environment error before serving the app', async () => {
    await expect(assertResourcesAvailableInEnvironment(
      environmentCheckingMcp(),
      resources,
      { localUploadId: {} as never },
      'staging',
    )).rejects.toThrow(
      'staging environment rejected required Retool resources: No resource named databaseId exists in requested environment',
    )
  })

  it('does not ask Retool to resolve resources supplied by private local configuration', async () => {
    await expect(assertResourcesAvailableInEnvironment(
      environmentCheckingMcp(),
      { localUploadId: resources.localUploadId },
      { localUploadId: {} as never },
      'staging',
    )).resolves.toBeUndefined()
  })
})

describe('Vite dependency cache isolation', () => {
  it('gives each app preview a port-scoped cache outside the panel cache', () => {
    expect(appViteCacheDir(5174)).toMatch(/node_modules\/\.vite\/app-5174$/)
    expect(appViteCacheDir(5175)).toMatch(/node_modules\/\.vite\/app-5175$/)
    expect(appViteCacheDir(5174)).not.toBe(appViteCacheDir(5175))
  })
})
