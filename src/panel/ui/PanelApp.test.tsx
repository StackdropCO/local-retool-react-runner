// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelApp } from './PanelApp'
import type { PanelApi } from './lib/api'
import type { ScannedApp } from './lib/types'

const exampleApp = {
  name: 'Example App',
  group: 'Operations',
  path: '/repo/apps-v2/Operations/Example App',
  branch: 'main',
  branches: ['main', 'feature'],
  worktrees: [
    {
      worktreePath: '/worktrees/main',
      appPath: '/worktrees/main/apps-v2/Operations/Example App',
      branch: 'main',
      head: '1111111111111111111111111111111111111111',
      dirty: false,
    },
    {
      worktreePath: '/worktrees/feature',
      appPath: '/worktrees/feature/apps-v2/Operations/Example App',
      branch: 'feature',
      head: '2222222222222222222222222222222222222222',
      dirty: true,
    },
  ],
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
    loadLocalResourceSpec: vi.fn(async () => ({
      resourceId: 'resource-uuid',
      binding: 'privateUpload',
      specFile: 'upload.openapi.yaml',
      specHash: '1234567890ab',
      content: 'openapi: 3.0.3\n',
    })),
    saveLocalResourceSpec: vi.fn(async (_resourceId: string, content: string) => ({
      resourceId: 'resource-uuid',
      binding: 'privateUpload',
      specFile: 'upload.openapi.yaml',
      specHash: 'abcdef123456',
      content,
    })),
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

    expect(await screen.findByText('example.retool.com')).toBeInTheDocument()
    expect(screen.getByText('connected · 0 apps running')).toBeInTheDocument()
    expect(api.status).toHaveBeenCalledOnce()
    expect(api.running).toHaveBeenCalledOnce()
  })

  it('shows private local API definitions without exposing their contents', async () => {
    const api = fakeApi()
    api.status = vi.fn(async () => ({
      mcpUrl: 'https://example.retool.com/mcp',
      cachedAuth: true,
      connected: true,
      repoDir: '/repo',
      localResourceError: '',
      localResources: [{
        resourceId: 'resource-uuid',
        binding: 'privateUpload',
        specFile: 'upload.openapi.yaml',
        specHash: '1234567890ab',
      }],
    }))

    render(<PanelApp api={api} />)

    expect(await screen.findByText('Local API specs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit privateUpload' })).toBeInTheDocument()
    expect(screen.getByText('upload.openapi.yaml · #1234567890ab')).toBeInTheDocument()
    expect(screen.queryByText(/files\.slack\.com/)).not.toBeInTheDocument()
  })

  it('opens, edits, saves a private spec and refreshes its fingerprint', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    let statusCalls = 0
    api.status = vi.fn(async () => ({
      mcpUrl: 'https://example.retool.com/mcp',
      cachedAuth: true,
      connected: true,
      repoDir: '/repo',
      localResources: [{
        resourceId: 'resource-uuid',
        binding: 'privateUpload',
        specFile: 'upload.openapi.yaml',
        specHash: statusCalls++ === 0 ? '1234567890ab' : 'abcdef123456',
      }],
    }))
    api.loadLocalResourceSpec = vi.fn(async () => ({
      resourceId: 'resource-uuid',
      binding: 'privateUpload',
      specFile: 'upload.openapi.yaml',
      specHash: '1234567890ab',
      content: 'openapi: 3.0.3\ninfo:\n  title: Original\n',
    }))

    render(<PanelApp api={api} />)
    await user.click(await screen.findByRole('button', { name: 'Edit privateUpload' }))

    const editor = await screen.findByLabelText('OpenAPI document for privateUpload')
    expect(editor).toHaveValue('openapi: 3.0.3\ninfo:\n  title: Original\n')
    await user.clear(editor)
    await user.type(editor, 'openapi: 3.0.3\ninfo:\n  title: Updated\n')
    await user.click(screen.getByRole('button', { name: 'Validate and save' }))

    await waitFor(() => expect(api.saveLocalResourceSpec).toHaveBeenCalledWith(
      'resource-uuid',
      'openapi: 3.0.3\ninfo:\n  title: Updated\n',
    ))
    expect(await screen.findByText('upload.openapi.yaml · #abcdef123456')).toBeInTheDocument()
  })

  it('keeps invalid source in the editor and shows the validation error', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    api.status = vi.fn(async () => ({
      mcpUrl: 'https://example.retool.com/mcp', cachedAuth: true, connected: true, repoDir: '/repo',
      localResourceError: 'Unable to parse the current OpenAPI document',
      localResources: [{
        resourceId: 'resource-uuid', binding: 'privateUpload', specFile: 'upload.openapi.yaml', specHash: '1234567890ab',
      }],
    }))
    api.saveLocalResourceSpec = vi.fn(async () => { throw new Error('Unable to parse OpenAPI document') })

    render(<PanelApp api={api} />)
    await user.click(await screen.findByRole('button', { name: 'Edit privateUpload' }))
    const editor = await screen.findByLabelText('OpenAPI document for privateUpload')
    await user.clear(editor)
    await user.type(editor, 'openapi: 3')
    await user.click(screen.getByRole('button', { name: 'Validate and save' }))

    expect(await screen.findByText('Unable to parse OpenAPI document')).toBeInTheDocument()
    expect(editor).toHaveValue('openapi: 3')
  })

  it('labels a UUID-matched REST resource as locally configured', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    api.resources = vi.fn(async () => ({ resources: [{
      name: 'resource-uuid',
      displayName: 'Private file upload',
      type: 'restapi',
      readable: true,
      localConfigured: true,
      note: 'upload.openapi.yaml · #1234567890ab',
    }] }))
    render(<PanelApp api={api} />)

    await user.click(await screen.findByRole('button', { name: 'Load' }))

    expect(await screen.findByText('local — upload.openapi.yaml · #1234567890ab')).toBeInTheDocument()
  })

  it('scans a repository and runs the selected exact worktree read-only', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    const repoInput = await screen.findByLabelText('Apps repository directory')
    await user.clear(repoInput)
    await user.type(repoInput, '/repo')
    await user.click(screen.getByRole('button', { name: 'Scan' }))
    await user.selectOptions(await screen.findByLabelText('Worktree for Example App'), '/worktrees/feature')
    await user.click(screen.getByRole('button', { name: 'Run Example App' }))

    expect(api.run).toHaveBeenCalledWith({
      appPath: '/worktrees/feature/apps-v2/Operations/Example App',
      worktreePath: '/worktrees/feature',
      name: 'Example App',
      branch: 'feature',
      writes: false,
    })
  })

  it('renders a stale scan payload without worktrees as unavailable instead of crashing', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    const staleApp = { ...exampleApp, worktrees: undefined } as unknown as ScannedApp
    api.scan = vi.fn(async () => ({ apps: [staleApp], repoDir: '/repo' }))
    render(<PanelApp api={api} />)

    await user.click(await screen.findByRole('button', { name: 'Scan' }))

    expect(await screen.findByRole('option', { name: 'no registered worktree' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Example App' })).toBeDisabled()
  })

  it('requires confirmation before an app can run with writes', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await screen.findByLabelText('Apps repository directory')
    await user.click(screen.getByRole('button', { name: 'Scan' }))
    const writeSwitch = await screen.findByRole('switch', { name: 'Enable writes for Example App' })
    await user.click(writeSwitch)

    expect(screen.getByRole('alertdialog')).toHaveTextContent('production')
    expect(writeSwitch).toHaveAttribute('aria-checked', 'false')

    await user.click(screen.getByRole('button', { name: 'Enable writes' }))
    await waitFor(() => expect(writeSwitch).toHaveAttribute('aria-checked', 'true'))
    await user.click(screen.getByRole('button', { name: 'Run Example App' }))

    expect(api.run).toHaveBeenCalledWith(expect.objectContaining({ writes: true }))
  })

  it('shows the exact worktree identity for a running preview', async () => {
    const api = fakeApi()
    api.running = vi.fn(async () => ({
      apps: [{
        name: 'Example App',
        appPath: '/worktrees/feature/apps-v2/Operations/Example App',
        worktreePath: '/worktrees/feature',
        branch: 'feature',
        head: '2222222222222222222222222222222222222222',
        dirty: true,
        port: 5174,
        url: 'http://localhost:5174',
        writes: false,
      }],
    }))

    render(<PanelApp api={api} />)

    expect(await screen.findByText('feature · 2222222 · modified')).toBeInTheDocument()
    expect(screen.getByText('/worktrees/feature')).toBeInTheDocument()
  })
})
