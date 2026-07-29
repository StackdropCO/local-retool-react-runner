import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPanelApi } from './api'

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

  it('sends the existing run payload unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ port: 5174, url: 'http://localhost:5174' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createPanelApi().run({
      appPath: '/repo/apps-v2/Group/App',
      name: 'App',
      branch: 'main',
      writes: false,
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appPath: '/repo/apps-v2/Group/App',
        name: 'App',
        branch: 'main',
        writes: false,
      }),
    })
  })
})
