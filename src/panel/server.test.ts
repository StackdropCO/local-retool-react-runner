import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPanelServer, type PanelServer } from './server'

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

    const [page, status] = await Promise.all([
      fetch(panel.url).then((response) => response.text()),
      fetch(`${panel.url}/api/status`).then((response) => response.json()),
    ])

    expect(page).toContain('<div id="root"></div>')
    expect(page).toContain('/main.tsx')
    expect(status).toEqual(expect.objectContaining({
      connected: false,
      cachedAuth: expect.any(Boolean),
      localResources: expect.any(Array),
      localResourceError: expect.any(String),
    }))
  })

  it('requires an exact worktree path instead of resolving a branch implicitly', async () => {
    panel = await createPanelServer(0)

    const response = await fetch(`${panel.url}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appPath: '/repo/apps-v2/Group/App', branch: 'feature', name: 'App' }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'worktreePath required' })
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
