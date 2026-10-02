import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRunnerArgs, createPanelServer, panelViteCacheDir, resolveExploreCheckoutForApp, runnerExitResponse, type PanelServer } from './server'

const temporaryDirectories: string[] = []
const validSpec = `openapi: 3.0.3
info: { title: Upload, version: 1.0.0 }
servers:
  - url: https://uploads.example.test
paths:
  /upload:
    post:
      responses:
        "200": { description: Uploaded }
`

function localResourcesFixture(): { directory: string; specPath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'panel-local-spec-'))
  temporaryDirectories.push(directory)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'resources.json'), JSON.stringify({
    version: 1,
    resources: {
      'resource-uuid': {
        binding: 'privateUpload',
        spec: './upload.openapi.yaml',
        baseUrl: 'https://uploads.example.test',
      },
    },
  }))
  const specPath = join(directory, 'upload.openapi.yaml')
  writeFileSync(specPath, validSpec)
  return { directory, specPath }
}

describe('panel server', () => {
  let panel: PanelServer | undefined

  afterEach(async () => {
    await panel?.close()
    panel = undefined
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('serves the React panel shell and keeps the status API available', async () => {
    panel = await createPanelServer(0)

    const [page, status, favicon] = await Promise.all([
      fetch(panel.url).then((response) => response.text()),
      fetch(`${panel.url}/api/status`).then((response) => response.json()),
      fetch(`${panel.url}/favicon.ico`),
    ])

    expect(page).toContain('<div id="root"></div>')
    expect(page).toContain('/main.tsx')
    expect(status).toEqual(expect.objectContaining({
      connected: false,
      cachedAuth: expect.any(Boolean),
      localResources: expect.any(Array),
      localResourceError: expect.any(String),
    }))
    expect(favicon.status).toBe(204)
  })

  it('persists a validated emulated current user', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'panel-current-user-'))
    temporaryDirectories.push(directory)
    const configFile = join(directory, 'config.json')
    writeFileSync(configFile, JSON.stringify({ mcpUrl: 'https://example.retool.com/mcp' }))
    panel = await createPanelServer(0, { configFile })
    const currentUser = {
      id: 42, email: 'operator@example.com', firstName: 'Op', lastName: 'Erator', fullName: 'Op Erator',
      profilePhotoUrl: null, groups: [{ id: 7, name: 'Operators' }], metadata: { geo: 'gbr' },
      sid: 'user_operator', externalIdentifier: null, locale: 'en',
    }

    const saved = await fetch(`${panel.url}/api/current-user`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentUser }),
    })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toEqual({ currentUser })
    await expect(fetch(`${panel.url}/api/status`).then((response) => response.json()))
      .resolves.toMatchObject({ currentUser })
    expect(JSON.parse(readFileSync(configFile, 'utf8')).currentUser).toEqual(currentUser)

    const invalid = await fetch(`${panel.url}/api/current-user`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentUser: { id: 'wrong', email: '', groups: [] } }),
    })
    expect(invalid.status).toBe(400)
  })

  it('syncs CLI identity while preserving locally edited groups when MCP is not configured', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'panel-cli-user-'))
    temporaryDirectories.push(directory)
    const configFile = join(directory, 'config.json')
    writeFileSync(configFile, JSON.stringify({
      currentUser: {
        id: 42,
        email: 'old@example.com',
        firstName: 'Old',
        lastName: 'Name',
        fullName: 'Old Name',
        profilePhotoUrl: null,
        groups: [{ id: 7, name: 'Local Operators' }],
        metadata: { geo: 'gbr' },
        sid: 'local-user',
        externalIdentifier: null,
        locale: 'en',
      },
    }))
    panel = await createPanelServer(0, {
      configFile,
      runCli: async (args) => {
        expect(args).toEqual(['whoami', '--json'])
        return { stdout: JSON.stringify({ name: 'CLI User', email: 'cli@example.com' }), stderr: '' }
      },
    })

    const response = await fetch(`${panel.url}/api/current-user/from-cli`, { method: 'POST' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      currentUser: {
        id: 42,
        email: 'cli@example.com',
        firstName: 'CLI',
        lastName: 'User',
        fullName: 'CLI User',
        groups: [{ id: 7, name: 'Local Operators' }],
        metadata: { geo: 'gbr' },
      },
    })
    expect(JSON.parse(readFileSync(configFile, 'utf8'))).toMatchObject({
      currentUser: {
        email: 'cli@example.com',
        groups: [{ id: 7, name: 'Local Operators' }],
      },
    })
  })

  it('loads the Retool group catalog through the metadata-only provider', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'panel-groups-'))
    temporaryDirectories.push(directory)
    const configFile = join(directory, 'config.json')
    writeFileSync(configFile, JSON.stringify({ mcpUrl: 'https://example.retool.com/mcp' }))
    const requestedUrls: string[] = []
    panel = await createPanelServer(0, {
      configFile,
      loadGroups: async (mcpUrl) => {
        requestedUrls.push(mcpUrl)
        return [{ id: 7, name: 'Operators' }, { id: 8, name: 'Viewers' }]
      },
    })

    const response = await fetch(`${panel.url}/api/groups`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      groups: [{ id: 7, name: 'Operators' }, { id: 8, name: 'Viewers' }],
    })
    expect(requestedUrls).toEqual(['https://example.retool.com/mcp'])
  })

  it('saves and authorizes the metadata-only MCP connection', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'panel-mcp-settings-'))
    temporaryDirectories.push(directory)
    const configFile = join(directory, 'config.json')
    const authorizedUrls: string[] = []
    panel = await createPanelServer(0, {
      configFile,
      authorizeMcp: async (mcpUrl) => { authorizedUrls.push(mcpUrl) },
    })

    const saved = await fetch(`${panel.url}/api/mcp-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mcpUrl: 'https://example.retool.com/mcp' }),
    })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toMatchObject({ mcpUrl: 'https://example.retool.com/mcp' })
    await expect(fetch(`${panel.url}/api/status`).then((response) => response.json()))
      .resolves.toMatchObject({ mcpUrl: 'https://example.retool.com/mcp' })

    const authorized = await fetch(`${panel.url}/api/auth`, { method: 'POST' })
    expect(authorized.status).toBe(200)
    await expect(authorized.json()).resolves.toEqual({
      connected: true,
      mcpUrl: 'https://example.retool.com/mcp',
    })
    expect(authorizedUrls).toEqual(['https://example.retool.com/mcp'])
    expect(JSON.parse(readFileSync(configFile, 'utf8')).mcpUrl).toBe('https://example.retool.com/mcp')
  })

  it('reports group-directory failures without affecting CLI execution', async () => {
    panel = await createPanelServer(0, {
      loadGroups: async () => { throw new Error('authentication required') },
    })

    const response = await fetch(`${panel.url}/api/groups`)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Could not load the Retool group directory: authentication required',
    })
  })

  it('detects the installed Retool CLI version and authentication status', async () => {
    const calls: string[][] = []
    panel = await createPanelServer(0, {
      runCli: async (args) => {
        calls.push(args)
        return args[0] === '--version'
          ? { stdout: '0.4.65 (launcher 0.1.4)', stderr: '' }
          : {
              stdout: JSON.stringify({
                defaultHost: 'https://example.retool.com',
                hosts: [{ host: 'https://example.retool.com', userEmail: 'dev@example.com' }],
              }),
              stderr: '',
            }
      },
    })

    const response = await fetch(`${panel.url}/api/cli/status`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      version: '0.4.65 (launcher 0.1.4)',
      status: {
        defaultHost: 'https://example.retool.com',
        hosts: [{ host: 'https://example.retool.com', userEmail: 'dev@example.com' }],
      },
    })
    expect(calls).toEqual(expect.arrayContaining([
      ['--version'],
      ['auth', 'status', '--json'],
    ]))
  })

  it('isolates live and test panel dependency caches', () => {
    expect(panelViteCacheDir(5170, 1)).toMatch(/node_modules\/\.vite\/panel-5170$/)
    expect(panelViteCacheDir(0, 1)).toMatch(/node_modules\/\.vite\/panel-test-\d+-1$/)
    expect(panelViteCacheDir(0, 1)).not.toBe(panelViteCacheDir(0, 2))
  })

  it('requires an app source path instead of resolving a branch implicitly', async () => {
    panel = await createPanelServer(0)

    const response = await fetch(`${panel.url}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appPath: '/repo/apps-v2/Group/App', branch: 'feature', name: 'App' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'app source directory required' })
  })

  it('uses a scanned Retool CLI checkout as both app source and resource checkout', async () => {
    const checkout = mkdtempSync(join(tmpdir(), 'panel-cli-checkout-'))
    temporaryDirectories.push(checkout)
    const configFile = join(checkout, 'panel-config.json')
    mkdirSync(join(checkout, 'frontend'), { recursive: true })
    mkdirSync(join(checkout, '.retool'), { recursive: true })
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ retool: { app: { name: 'CLI App' } } }))
    writeFileSync(join(checkout, 'frontend', 'App.tsx'), 'export default function App() { return null }\n')
    writeFileSync(join(checkout, '.retool', 'app.json'), '{}')
    panel = await createPanelServer(0, { configFile })

    const scan = await fetch(`${panel.url}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoDir: checkout }),
    })

    expect(scan.status).toBe(200)
    await expect(scan.json()).resolves.toMatchObject({
      repoDir: checkout,
      apps: [{ name: 'CLI App' }],
    })
    expect(JSON.parse(readFileSync(configFile, 'utf8'))).toMatchObject({
      repoDir: checkout,
      exploreCheckoutDir: checkout,
    })
  })

  it('pairs Git source with the CLI checkout for the same Retool app UUID', () => {
    const root = mkdtempSync(join(tmpdir(), 'panel-hybrid-source-'))
    temporaryDirectories.push(root)
    const gitApp = join(root, 'git', 'apps-v2', 'Group', 'Git App')
    const cliRoot = join(root, 'cli')
    const matchingCheckout = join(cliRoot, 'app-uuid')
    const unrelatedCheckout = join(cliRoot, 'other-app')

    for (const [path, uuid] of [[gitApp, 'app-uuid'], [matchingCheckout, 'app-uuid'], [unrelatedCheckout, 'other-uuid']] as const) {
      mkdirSync(join(path, 'frontend'), { recursive: true })
      writeFileSync(join(path, 'package.json'), JSON.stringify({ retool: { app: { name: 'App', uuid } } }))
      writeFileSync(join(path, 'frontend', 'App.tsx'), 'export default function App() { return null }\n')
    }
    mkdirSync(join(matchingCheckout, '.retool'), { recursive: true })
    mkdirSync(join(unrelatedCheckout, '.retool'), { recursive: true })
    writeFileSync(join(matchingCheckout, '.retool', 'app.json'), '{}')
    writeFileSync(join(unrelatedCheckout, '.retool', 'app.json'), '{}')

    expect(resolveExploreCheckoutForApp(gitApp, {
      cliAppsDir: cliRoot,
      exploreCheckoutDir: unrelatedCheckout,
    })).toBe(matchingCheckout)
  })

  it('does not use a CLI bridge that lacks the Git app resources', () => {
    const root = mkdtempSync(join(tmpdir(), 'panel-hybrid-mismatch-'))
    temporaryDirectories.push(root)
    const gitApp = join(root, 'git-app')
    const unrelatedCheckout = join(root, 'unrelated-cli-app')
    for (const [path, uuid] of [[gitApp, 'git-uuid'], [unrelatedCheckout, 'other-uuid']] as const) {
      mkdirSync(join(path, 'frontend'), { recursive: true })
      writeFileSync(join(path, 'package.json'), JSON.stringify({
        retool: { app: {
          name: 'App',
          uuid,
          ...(path === gitApp ? {
            resourceReferencesByFile: {
              '/backend/getData.ts': [{ name: 'required-resource', displayName: 'Warehouse', type: 'postgresql' }],
            },
          } : {}),
        } },
      }))
      writeFileSync(join(path, 'frontend', 'App.tsx'), 'export default function App() { return null }\n')
    }
    mkdirSync(join(unrelatedCheckout, '.retool'), { recursive: true })
    writeFileSync(join(unrelatedCheckout, '.retool', 'app.json'), JSON.stringify({ host: 'https://example.retool.com' }))
    writeFileSync(join(unrelatedCheckout, '.retool', 'resource-cache.json'), JSON.stringify({ resources: [] }))

    expect(resolveExploreCheckoutForApp(gitApp, {
      mcpUrl: 'https://example.retool.com/mcp',
      exploreCheckoutDir: unrelatedCheckout,
    })).toBeUndefined()
  })

  it('isolates Git source from a same-org CLI bridge with matching resources', () => {
    const root = mkdtempSync(join(tmpdir(), 'panel-resource-bridge-'))
    temporaryDirectories.push(root)
    const gitApp = join(root, 'git-app')
    const resourceBridge = join(root, 'resource-bridge')
    mkdirSync(join(gitApp, 'frontend'), { recursive: true })
    mkdirSync(join(resourceBridge, '.retool'), { recursive: true })
    writeFileSync(join(gitApp, 'package.json'), JSON.stringify({
      retool: { app: {
        name: 'Git App',
        uuid: 'git-uuid',
        resourceReferencesByFile: {
          '/backend/getData.ts': [{ name: 'databricks-uuid', displayName: 'Databricks', type: 'databricks' }],
        },
      } },
    }))
    writeFileSync(join(gitApp, 'frontend', 'App.tsx'), 'export default function App() { return null }\n')
    writeFileSync(join(resourceBridge, 'package.json'), JSON.stringify({
      retool: { app: { name: 'Bridge App', uuid: 'bridge-uuid' } },
    }))
    writeFileSync(join(resourceBridge, '.retool', 'app.json'), JSON.stringify({ host: 'https://example.retool.com' }))
    writeFileSync(join(resourceBridge, '.retool', 'resource-cache.json'), JSON.stringify({
      resources: [{ name: 'databricks-uuid', displayName: 'Databricks', type: 'databricks', symbols: ['databricks'] }],
    }))

    expect(resolveExploreCheckoutForApp(gitApp, {
      mcpUrl: 'https://example.retool.com/mcp',
      exploreCheckoutDir: resourceBridge,
    })).toBe(resourceBridge)
  })

  it('reports whether each Git app has its matching CLI runtime checkout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'panel-git-preflight-'))
    temporaryDirectories.push(root)
    const gitRoot = join(root, 'git')
    const cliRoot = join(root, 'cli')
    const readyApp = join(gitRoot, 'apps-v2', 'Group', 'Ready App')
    const missingApp = join(gitRoot, 'apps-v2', 'Group', 'Missing App')
    const readyCheckout = join(cliRoot, 'ready-uuid')
    for (const [path, name, uuid] of [
      [readyApp, 'Ready App', 'ready-uuid'],
      [missingApp, 'Missing App', 'missing-uuid'],
      [readyCheckout, 'Ready App', 'ready-uuid'],
    ] as const) {
      mkdirSync(join(path, 'frontend'), { recursive: true })
      writeFileSync(join(path, 'package.json'), JSON.stringify({ retool: { app: { name, uuid } } }))
      writeFileSync(join(path, 'frontend', 'App.tsx'), 'export default function App() { return null }\n')
    }
    mkdirSync(join(readyCheckout, '.retool'), { recursive: true })
    writeFileSync(join(readyCheckout, '.retool', 'app.json'), '{}')
    const configFile = join(root, 'panel-config.json')
    writeFileSync(configFile, JSON.stringify({ cliAppsDir: cliRoot }))
    panel = await createPanelServer(0, { configFile })

    const response = await fetch(`${panel.url}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoDir: gitRoot, sourceMode: 'git' }),
    })

    expect(response.status).toBe(200)
    const payload = await response.json() as { apps: Array<{ name: string; uuid: string; cliCheckoutAvailable: boolean }> }
    expect(payload.apps).toEqual([
      expect.objectContaining({ name: 'Missing App', uuid: 'missing-uuid', cliCheckoutAvailable: false }),
      expect.objectContaining({ name: 'Ready App', uuid: 'ready-uuid', cliCheckoutAvailable: true }),
    ])
  })

  it('runs clone and pull through the Retool CLI and saves the cloned checkout', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'panel-cli-lifecycle-'))
    temporaryDirectories.push(parent)
    const configFile = join(parent, 'config.json')
    const target = join(parent, 'app-uuid')
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const installs: string[] = []
    const runCli = async (args: string[], options?: { cwd?: string }) => {
      calls.push({ args, cwd: options?.cwd })
      if (args[0] === 'clone') {
        mkdirSync(join(target, '.retool'), { recursive: true })
        writeFileSync(join(target, '.retool', 'app.json'), '{}')
      }
      return { stdout: JSON.stringify({ ok: true }), stderr: '' }
    }
    panel = await createPanelServer(0, {
      configFile,
      runCli,
      installDependencies: async (checkoutDir) => { installs.push(checkoutDir) },
    })

    const clone = await fetch(`${panel.url}/api/cli/clone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'app-uuid', parentDir: parent, branch: 'feature', host: 'example.retool.com' }),
    })
    expect(clone.status).toBe(200)
    await expect(clone.json()).resolves.toEqual({
      result: { status: 'cloned', message: 'App cloned and dependencies installed.', checkoutDir: target },
      checkoutDir: target,
      appsRootDir: parent,
    })
    expect(calls[0]).toEqual({
      args: ['clone', 'app-uuid', '--branch', 'feature', '--host', 'example.retool.com'],
      cwd: parent,
    })
    expect(installs).toEqual([target])
    expect(JSON.parse(readFileSync(configFile, 'utf8'))).toMatchObject({
      repoDir: parent,
      exploreCheckoutDir: target,
    })

    const pull = await fetch(`${panel.url}/api/cli/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkoutDir: target }),
    })
    expect(pull.status).toBe(200)
    expect(calls[1]).toEqual({ args: ['pull', '--json'], cwd: target })
  })

  it('requires explicit confirmation for preview pushes and blocks publishing', async () => {
    const checkout = mkdtempSync(join(tmpdir(), 'panel-cli-push-'))
    temporaryDirectories.push(checkout)
    mkdirSync(join(checkout, '.retool'), { recursive: true })
    writeFileSync(join(checkout, '.retool', 'app.json'), '{}')
    const calls: Array<{ args: string[]; cwd?: string }> = []
    const runCli = async (args: string[], options?: { cwd?: string }) => {
      calls.push({ args, cwd: options?.cwd })
      return { stdout: JSON.stringify({ previewUrl: 'https://example.retool.com/apps/app-uuid' }), stderr: '' }
    }
    panel = await createPanelServer(0, { runCli })

    const unconfirmed = await fetch(`${panel.url}/api/cli/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkoutDir: checkout, message: 'Finish report filters' }),
    })
    expect(unconfirmed.status).toBe(400)
    expect(calls).toEqual([])

    const pushed = await fetch(`${panel.url}/api/cli/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkoutDir: checkout, message: 'Finish report filters', confirmed: true }),
    })
    expect(pushed.status).toBe(200)
    await expect(pushed.json()).resolves.toEqual({
      result: { previewUrl: 'https://example.retool.com/apps/app-uuid' },
    })
    expect(calls).toEqual([{
      args: ['push', '--wait', '--message', 'Finish report filters', '--json'],
      cwd: checkout,
    }])

    const publish = await fetch(`${panel.url}/api/cli/publish`, { method: 'POST' })
    expect(publish.status).toBe(405)
    expect(calls).toHaveLength(1)
  })


  it('rejects unknown Retool environments before launching a runner', async () => {
    panel = await createPanelServer(0)

    const response = await fetch(`${panel.url}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ environment: 'preview' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid environment "preview"; expected staging or production',
    })
  })

  it('launches the child with the selected environment', () => {
    expect(buildRunnerArgs({
      appPath: '/repo/apps-v2/Group/App',
      port: 5174,
      environment: 'staging',
      writes: false,
    })).toEqual([
      'src/dev.ts', '--app', '/repo/apps-v2/Group/App', '--port', '5174',
      '--environment', 'staging',
    ])
  })

  it('passes the configured Retool CLI checkout to the child runner', () => {
    expect(buildRunnerArgs({
      appPath: '/repo/apps-v2/Group/App',
      port: 5174,
      environment: 'staging',
      writes: false,
      exploreCheckoutDir: '/retool/checkout',
    })).toContainEqual('--checkout')
    expect(buildRunnerArgs({
      appPath: '/repo/apps-v2/Group/App',
      port: 5174,
      environment: 'staging',
      writes: false,
      exploreCheckoutDir: '/retool/checkout',
    })).toContainEqual('/retool/checkout')
  })

  it('returns linked resource names instead of UUID-heavy environment errors', () => {
    expect(runnerExitResponse(
      'Shift Utilization Dashboard',
      'staging',
      1,
      'Error: staging environment rejected required Retool resources: No resource named "slack-id" exists, No resource named "database-id" exists\n    at startServer',
      [
        { name: 'slack-id', displayName: 'Slack', type: 'slackopenapi' },
        { name: 'database-id', displayName: 'Databricks', type: 'databricks' },
        { name: 'available-id', displayName: 'Lakebase', type: 'databricksLakebase' },
      ],
      'https://example.retool.com/mcp',
    )).toEqual({
      error: "Shift Utilization Dashboard can't run in staging.",
      missingResources: [
        {
          name: 'Slack',
          resourceId: 'slack-id',
          url: 'https://example.retool.com/resources/slack-id',
        },
        {
          name: 'Databricks',
          resourceId: 'database-id',
          url: 'https://example.retool.com/resources/database-id',
        },
      ],
    })
  })

  it('surfaces an unexpected runner error instead of hiding it behind the exit code', () => {
    expect(runnerExitResponse(
      'Shift Utilization Dashboard',
      'staging',
      1,
      'Error: Local resource fleet360 is not referenced by this app\n    at startServer',
      [],
      'https://example.retool.com/mcp',
    )).toEqual({
      error: 'Shift Utilization Dashboard did not start in staging: Local resource fleet360 is not referenced by this app',
    })
  })

  it('loads and saves a configured local OpenAPI document by UUID', async () => {
    const { directory, specPath } = localResourcesFixture()
    panel = await createPanelServer(0, { localResourceDirectory: directory })

    const loaded = await fetch(`${panel.url}/api/local-resources/resource-uuid/spec`)
    expect(loaded.status).toBe(200)
    await expect(loaded.json()).resolves.toMatchObject({
      resourceId: 'resource-uuid',
      binding: 'privateUpload',
      specFile: 'upload.openapi.yaml',
      content: validSpec,
    })

    const updated = validSpec.replace('title: Upload', 'title: Updated upload')
    const saved = await fetch(`${panel.url}/api/local-resources/resource-uuid/spec`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: updated }),
    })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toMatchObject({ content: updated, specHash: expect.any(String) })
    expect(readFileSync(specPath, 'utf8')).toBe(updated)
  })

  it('rejects invalid source and unknown UUIDs without changing a private spec', async () => {
    const { directory, specPath } = localResourcesFixture()
    panel = await createPanelServer(0, { localResourceDirectory: directory })

    const invalid = await fetch(`${panel.url}/api/local-resources/resource-uuid/spec`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'openapi: [' }),
    })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({ error: expect.stringMatching(/parse/i) })
    expect(readFileSync(specPath, 'utf8')).toBe(validSpec)

    const missing = await fetch(`${panel.url}/api/local-resources/missing/spec`)
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ error: 'Local resource missing is not configured' })
  })

  it('keeps an invalid configured document visible and readable for repair', async () => {
    const { directory, specPath } = localResourcesFixture()
    writeFileSync(specPath, 'openapi: [')
    panel = await createPanelServer(0, { localResourceDirectory: directory })

    const status = await fetch(`${panel.url}/api/status`).then((response) => response.json())
    expect(status.localResources).toEqual([expect.objectContaining({
      resourceId: 'resource-uuid',
      binding: 'privateUpload',
      specFile: 'upload.openapi.yaml',
    })])
    expect(status.localResourceError).toMatch(/parse/i)

    const loaded = await fetch(`${panel.url}/api/local-resources/resource-uuid/spec`)
    await expect(loaded.json()).resolves.toMatchObject({ content: 'openapi: [' })
  })
})
