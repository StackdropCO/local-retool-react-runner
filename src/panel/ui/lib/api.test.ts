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

  it('explains that a CLI 404 means the panel backend must be restarted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }))

    await expect(createPanelApi().cliStatus()).rejects.toThrow(
      'This panel backend does not support Retool CLI actions yet. Stop it, restart `pnpm panel`, then reload this page.',
    )
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

  it('saves the emulated current user through the identity endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const currentUser = {
      id: 1, email: 'dev@example.com', firstName: 'Dev', lastName: 'User', fullName: 'Dev User',
      profilePhotoUrl: null, groups: [], metadata: {}, sid: 'user_dev', externalIdentifier: null, locale: 'en',
    }

    await createPanelApi().saveCurrentUser(currentUser)

    expect(fetchMock).toHaveBeenCalledWith('/api/current-user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentUser }),
    })
  })

  it('sends an explicitly confirmed Retool preview push', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: {} }) })
    vi.stubGlobal('fetch', fetchMock)

    await createPanelApi().cliPush('/retool/checkout', 'Finish report filters', true)

    expect(fetchMock).toHaveBeenCalledWith('/api/cli/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        checkoutDir: '/retool/checkout',
        message: 'Finish report filters',
        confirmed: true,
      }),
    })
  })

})
