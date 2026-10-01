import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer as createNetServer } from 'node:net'
import { appHmrPort, appViteCacheDir, assertResourcesAvailableInEnvironment, discoverEndpoints, startServer } from './server.js'
import type { McpClient } from './mcpClient.js'
import type { ResourceMap } from './resourceGlobals.js'

const APP = process.env.RETOOL_TEST_APP || ''

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createNetServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    server.close(() => resolve(port))
  })
})

describe.skipIf(!APP || !existsSync(join(APP, 'backend')))('discoverEndpoints (set RETOOL_TEST_APP to run)', () => {
  it('finds default-export endpoints and excludes non-endpoint helpers', () => {
    const eps = discoverEndpoints(APP)
    expect(eps.length).toBeGreaterThan(0)
    // shared helper modules (no default export) must be excluded
    expect(eps).not.toContain('shared')
  })
})

describe('discoverEndpoints', () => {
  it('ignores TypeScript declarations even when they contain a default export', () => {
    const root = mkdtempSync(join(tmpdir(), 'runner-endpoints-'))
    try {
      mkdirSync(join(root, 'backend'), { recursive: true })
      writeFileSync(join(root, 'backend', 'load.ts'), 'export default async function load() {}')
      writeFileSync(join(root, 'backend', '_client.d.ts'), 'export default interface Client {}')
      expect(discoverEndpoints(root)).toEqual(['load'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
    async listGroups() { return [] },
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

  it('does not ask MCP to resolve resources assigned to Retool CLI explore', async () => {
    const mcp = environmentCheckingMcp()
    await expect(assertResourcesAvailableInEnvironment(
      mcp,
      { localUploadId: { ...resources.localUploadId, transport: 'explore' } },
      {},
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

  it('keeps the derived HMR port valid for high ephemeral app ports', () => {
    expect(appHmrPort(62_613)).toBeGreaterThanOrEqual(1024)
    expect(appHmrPort(62_613)).toBeLessThan(65_536)
    expect(appHmrPort(5174)).toBe(8174)
  })
})

describe('current user emulation', () => {
  it('serves the configured identity and passes the same user to backend endpoints', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'local-mcp-current-user-'))
    mkdirSync(join(appDir, 'frontend'), { recursive: true })
    mkdirSync(join(appDir, 'backend'), { recursive: true })
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ retool: { app: { resourceReferencesByFile: {} } } }))
    writeFileSync(join(appDir, 'frontend', 'package.json'), JSON.stringify({ dependencies: {} }))
    writeFileSync(join(appDir, 'frontend', 'App.tsx'), 'export default function App() { return null }')
    writeFileSync(join(appDir, 'backend', 'whoAmI.ts'), 'export default async function whoAmI(req: any) { return req.user }')
    const mcp = environmentCheckingMcp()
    let user = { email: 'first@example.com' } as any
    const server = await startServer({
      appDir,
      port: await freePort(),
      writes: false,
      environmentName: 'staging',
      mcp,
      currentUser: () => user,
    })
    try {
      await expect(fetch(`${server.url}/api/current-user`).then((response) => response.json()))
        .resolves.toMatchObject({ user: { email: 'first@example.com' } })
      user = { email: 'second@example.com' }
      await expect(fetch(`${server.url}/rpc/whoAmI`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ params: {} }),
      }).then((response) => response.json())).resolves.toMatchObject({
        result: { email: 'second@example.com' },
      })
    } finally {
      await server.close()
      rmSync(appDir, { recursive: true, force: true })
    }
  }, 15_000)
})
