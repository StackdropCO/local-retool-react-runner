import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPanelApi, PanelApiError } from './api'

describe('panel API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('surfaces the API error message from a failed request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid URL' }),
      }),
    )

    await expect(createPanelApi().saveMcpUrl('bad')).rejects.toThrow('invalid URL')
  })

  it('preserves structured missing-resource details from a failed run', async () => {
    const body = {
      error: "Example App can't run in staging.",
      missingResources: [
        { name: 'Slack', resourceId: 'slack-id', url: 'https://example.retool.com/resources/slack-id' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => body,
    }))

    const failure = await createPanelApi().run({
      appPath: '/repo/apps-v2/Group/App',
      worktreePath: '/repo',
      name: 'App',
      branch: 'main',
      environment: 'staging',
      writes: false,
    }).catch((error) => error)

    expect(failure).toBeInstanceOf(PanelApiError)
    expect(failure.details).toEqual(body)
  })

  it('sends the existing run payload unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ port: 5174, url: 'http://localhost:5174' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createPanelApi().run({
      appPath: '/repo/apps-v2/Group/App',
      worktreePath: '/repo',
      name: 'App',
      branch: 'main',
      environment: 'staging',
      writes: false,
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appPath: '/repo/apps-v2/Group/App',
        worktreePath: '/repo',
        name: 'App',
        branch: 'main',
        environment: 'staging',
        writes: false,
      }),
    })
  })

  it('loads and saves local specs through UUID-scoped endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ resourceId: 'uuid/with spaces', content: 'openapi: 3.0.3' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = createPanelApi()

    await api.loadLocalResourceSpec('uuid/with spaces')
    await api.saveLocalResourceSpec('uuid/with spaces', 'openapi: 3.0.3')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/local-resources/uuid%2Fwith%20spaces/spec', undefined)
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/local-resources/uuid%2Fwith%20spaces/spec', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'openapi: 3.0.3' }),
    })
  })
})
