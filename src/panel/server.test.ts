import { afterEach, describe, expect, it } from 'vitest'
import { createPanelServer, type PanelServer } from './server'

describe('panel server', () => {
  let panel: PanelServer | undefined

  afterEach(async () => {
    await panel?.close()
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
    }))
  })
})
