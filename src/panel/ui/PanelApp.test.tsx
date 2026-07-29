// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelApp } from './PanelApp'
import type { PanelApi } from './lib/api'

const exampleApp = {
  name: 'Example App',
  group: 'Operations',
  path: '/repo/apps-v2/Operations/Example App',
  branch: 'main',
  branches: ['main', 'feature'],
  endpoints: ['getItems', 'saveItem'],
  resources: [{ displayName: 'Warehouse', type: 'postgresql' }],
}

afterEach(cleanup)

function fakeApi(): PanelApi {
  return {
    status: vi.fn(async () => ({
      mcpUrl: 'https://example.retool.com/mcp',
      cachedAuth: true,
      connected: true,
      repoDir: '/repo',
    })),
    saveMcpUrl: vi.fn(async (mcpUrl: string) => ({ mcpUrl, cachedAuth: true })),
    authorize: vi.fn(async () => ({ connected: true as const, mcpUrl: 'https://example.retool.com/mcp' })),
    resources: vi.fn(async () => ({ resources: [] })),
    browse: vi.fn(async () => ({ dir: '/repo', parent: '/', dirs: ['apps-v2'], isRepo: true })),
    scan: vi.fn(async () => ({ apps: [exampleApp], repoDir: '/repo' })),
    run: vi.fn(async () => ({ port: 5174, url: 'http://localhost:5174' })),
    running: vi.fn(async () => ({ apps: [] })),
    stop: vi.fn(async (port: number) => ({ stopped: port })),
  }
}

describe('PanelApp', () => {
  it('shows connection and running status loaded on startup', async () => {
    const api = fakeApi()
    render(<PanelApp api={api} />)

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Token cached')).toBeInTheDocument()
    expect(screen.getByText('No apps running')).toBeInTheDocument()
    expect(api.status).toHaveBeenCalledOnce()
    expect(api.running).toHaveBeenCalledOnce()
  })

  it('scans a repository and runs the selected branch read-only', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    const repoInput = await screen.findByLabelText('Apps repository')
    await user.clear(repoInput)
    await user.type(repoInput, '/repo')
    await user.click(screen.getByRole('button', { name: 'Scan apps' }))
    await user.selectOptions(await screen.findByLabelText('Branch for Example App'), 'feature')
    await user.click(screen.getByRole('button', { name: 'Run Example App' }))

    expect(api.run).toHaveBeenCalledWith({
      appPath: '/repo/apps-v2/Operations/Example App',
      name: 'Example App',
      branch: 'feature',
      writes: false,
    })
  })

  it('requires confirmation before an app can run with writes', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await screen.findByLabelText('Apps repository')
    await user.click(screen.getByRole('button', { name: 'Scan apps' }))
    const writeSwitch = await screen.findByRole('switch', { name: 'Enable writes for Example App' })
    await user.click(writeSwitch)

    expect(screen.getByRole('alertdialog')).toHaveTextContent('production data')
    expect(writeSwitch).toHaveAttribute('aria-checked', 'false')

    await user.click(screen.getByRole('button', { name: 'Enable writes' }))
    await waitFor(() => expect(writeSwitch).toHaveAttribute('aria-checked', 'true'))
    await user.click(screen.getByRole('button', { name: 'Run Example App' }))

    expect(api.run).toHaveBeenCalledWith(expect.objectContaining({ writes: true }))
  })
})
