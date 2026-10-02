// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelApp } from './PanelApp'
import { PanelApiError, type PanelApi } from './lib/api'
import type { ScannedApp } from './lib/types'

const currentUser = {
  id: 1,
  email: 'dev@example.com',
  firstName: 'Dev',
  lastName: 'User',
  fullName: 'Dev User',
  profilePhotoUrl: null,
  groups: [{ id: 10, name: 'Analytics viewers' }],
  metadata: {},
  sid: 'user_dev',
  externalIdentifier: null,
  locale: 'en',
}

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
      cliCheckout: true,
    },
    {
      worktreePath: '/worktrees/feature',
      appPath: '/worktrees/feature/apps-v2/Operations/Example App',
      branch: 'feature',
      head: '2222222222222222222222222222222222222222',
      dirty: true,
      cliCheckout: true,
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
      mcpConfigured: true,
      cachedAuth: true,
      connected: true,
      runtimeTransport: 'retool-cli' as const,
      exploreCheckoutDir: '/retool/checkout',
      repoDir: '/repo',
      cliAppsDir: '/repo',
      gitRepoDir: '/git-repo',
      sourceMode: 'cli' as const,
      currentUser,
    })),
    saveMcpUrl: vi.fn(async (mcpUrl: string) => ({ mcpUrl, cachedAuth: true })),
    authorize: vi.fn(async () => ({ connected: true as const, mcpUrl: 'https://example.retool.com/mcp' })),
    groups: vi.fn(async () => ({ groups: [{ id: 10, name: 'Analytics viewers' }] })),
    saveCurrentUser: vi.fn(async (user) => ({ currentUser: user })),
    syncCurrentUserFromCli: vi.fn(async () => ({ currentUser })),
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
    scan: vi.fn(async (repoDir: string, sourceMode: 'cli' | 'git' = 'cli') => ({ apps: [exampleApp], repoDir, sourceMode })),
    run: vi.fn(async () => ({ port: 5174, url: 'http://localhost:5174' })),
    running: vi.fn(async () => ({ apps: [] })),
    stop: vi.fn(async (port: number) => ({ stopped: port })),
    cliStatus: vi.fn(async () => ({
      version: '0.4.65',
      status: {
        defaultHost: 'https://example.retool.com',
        hosts: [{ host: 'https://example.retool.com', userEmail: 'dev@example.com', expired: false }],
      },
    })),
    cliLogin: vi.fn(async () => ({
      version: '0.4.65',
      status: {
        defaultHost: 'https://example.retool.com',
        hosts: [{ host: 'https://example.retool.com', userEmail: 'dev@example.com', expired: false }],
      },
    })),
    cliApps: vi.fn(async () => ({ apps: [{ id: 'app-uuid', name: 'Example App' }] })),
    cliClone: vi.fn(async (input) => ({
      result: { cloned: input.appId },
      checkoutDir: `${input.parentDir}/${input.appId}`,
      appsRootDir: input.parentDir,
    })),
    cliPull: vi.fn(async () => ({ result: { pulled: true } })),
    cliPush: vi.fn(async () => ({ result: { previewUrl: 'https://example.retool.com/apps/app-uuid' } })),
  }
}

describe('PanelApp', () => {
  it('shows CLI and running status loaded on startup', async () => {
    const api = fakeApi()
    render(<PanelApp api={api} />)

    expect(await screen.findByText('/repo')).toBeInTheDocument()
    expect(screen.getByText('Apps folder ready')).toBeInTheDocument()
    expect(screen.getByText('0 running')).toBeInTheDocument()
    expect(api.status).toHaveBeenCalledOnce()
    expect(api.running).toHaveBeenCalledOnce()
  })

  it('routes an unconfigured app source directly to the matching setup', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    const configuredStatus = await api.status()
    api.status = vi.fn(async () => ({
      ...configuredStatus,
      repoDir: '',
      cliAppsDir: '',
      gitRepoDir: '',
      sourceMode: 'cli' as const,
    }))

    render(<PanelApp api={api} />)

    await user.click(await screen.findByRole('button', { name: 'Configure CLI source' }))
    expect(screen.getByRole('tabpanel', { name: 'Settings' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: 'CLI checkouts' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('heading', { name: 'Retool CLI connection and source' })).toBeInTheDocument()
  })

  it('lists and clones a Retool app from Settings', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    await waitFor(() => expect(api.cliApps).toHaveBeenCalledWith('https://example.retool.com'))
    expect(screen.getByText(/Retool CLI 0.4.65/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Load apps' }))
    const parent = screen.getByLabelText('Local apps parent folder')
    await user.clear(parent)
    await user.type(parent, '/tmp/retool-apps')
    await user.click(screen.getByRole('button', { name: 'Clone app' }))

    await waitFor(() => expect(api.cliClone).toHaveBeenCalledWith({
      appId: 'app-uuid',
      parentDir: '/tmp/retool-apps',
      branch: undefined,
      host: 'https://example.retool.com',
    }))
    expect(api.scan).toHaveBeenCalledWith('/tmp/retool-apps', 'cli')
    expect(screen.getByText('Cloned Example App into /tmp/retool-apps/app-uuid, installed its dependencies, and made it available below.')).toBeInTheDocument()
    expect(screen.queryByText('Last CLI result')).not.toBeInTheDocument()
  })

  it('shows and updates the MCP connection in Settings', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Retool MCP connection' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Retool MCP connection' }).compareDocumentPosition(
      screen.getByRole('tablist', { name: 'App source type' }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(/Keeps supported read-only resource calls fast/)).toBeInTheDocument()
    const endpoint = screen.getByLabelText('MCP endpoint URL')
    await user.clear(endpoint)
    await user.type(endpoint, 'https://other.retool.com/mcp')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.saveMcpUrl).toHaveBeenCalledWith('https://other.retool.com/mcp'))

    await user.click(screen.getByRole('button', { name: 'Re-authorize' }))
    await waitFor(() => expect(api.authorize).toHaveBeenCalledOnce())
  })

  it('keeps Git source configuration in a separate Settings tab', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    await user.click(await screen.findByRole('tab', { name: 'Git' }))
    const repository = screen.getByLabelText('Git apps repository directory')
    expect(repository).toHaveValue('/git-repo')
    await user.clear(repository)
    await user.type(repository, '/repo/retool-ops')
    await user.click(screen.getByRole('button', { name: 'Use Git repository' }))

    await waitFor(() => expect(api.scan).toHaveBeenCalledWith('/repo/retool-ops', 'git'))
  })

  it('separates CLI checkouts and Git apps on the Apps page', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    const sourceTabs = await screen.findByRole('tablist', { name: 'App source' })
    expect(within(sourceTabs).getByRole('tab', { name: 'CLI checkouts' })).toHaveAttribute('data-state', 'active')
    expect(await screen.findByText(/Locally cloned Retool CLI apps/)).toBeInTheDocument()

    await user.click(within(sourceTabs).getByRole('tab', { name: 'Git' }))
    await waitFor(() => expect(api.scan).toHaveBeenCalledWith('/git-repo', 'git'))
    expect(screen.getByText(/Protected Apps as Code sources/)).toBeInTheDocument()
  })

  it('refreshes a stale Git resource bridge in the background', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    let gitScans = 0
    api.scan = vi.fn(async (repoDir: string, sourceMode: 'cli' | 'git' = 'cli') => ({
      apps: [{
        ...exampleApp,
        uuid: 'app-uuid',
        cliCheckoutAvailable: sourceMode !== 'git' || ++gitScans > 1,
      }],
      repoDir,
      sourceMode,
    }))
    render(<PanelApp api={api} />)

    const sourceTabs = await screen.findByRole('tablist', { name: 'App source' })
    await user.click(within(sourceTabs).getByRole('tab', { name: 'Git' }))

    expect(await screen.findByText('Resource bridge needs refresh.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run Example App' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh resources for Example App' }))

    await waitFor(() => expect(api.cliPull).toHaveBeenCalledWith('/retool/checkout'))
    expect(api.scan).toHaveBeenCalledWith('/git-repo', 'git')
    expect(api.cliClone).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Run Example App' })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: /Apps/ })).toHaveAttribute('data-state', 'active')
  })

  it('pulls the current Retool CLI checkout', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await user.click(await screen.findByRole('button', { name: 'Pull latest for Example App' }))

    await waitFor(() => expect(api.cliPull).toHaveBeenCalledWith('/worktrees/main'))
    expect(api.scan).toHaveBeenCalledWith('/repo', 'cli')
  })

  it('requires a message and confirmation before pushing a Retool preview', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await user.click(await screen.findByRole('button', { name: 'Push preview for Example App' }))
    const dialog = screen.getByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'Push preview' })
    expect(confirm).toBeDisabled()
    expect(api.cliPush).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText('Push message for Example App'), 'Finish report filters')
    await user.click(confirm)

    await waitFor(() => expect(api.cliPush).toHaveBeenCalledWith(
      '/worktrees/main',
      'Finish report filters',
      true,
    ))
  })

  it('shows and updates the identity used by frontend and backend code', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(await screen.findByText('Dev User')).toBeInTheDocument()
    expect(screen.getByText('Analytics viewers')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit emulated user' }))
    expect(await screen.findByLabelText('Retool groups')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'other@example.com')
    await user.click(screen.getByRole('button', { name: 'Save emulated user' }))

    await waitFor(() => expect(api.saveCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'other@example.com' }),
    ))
  })

  it('opens the emulated user editor directly from the persistent header control', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await user.click(await screen.findByRole('button', { name: 'Edit emulated user, currently Dev User' }))

    expect(screen.getByRole('tabpanel', { name: 'Settings' })).toHaveAttribute('data-state', 'active')
    expect(await screen.findByRole('dialog', { name: 'Mimic a Retool user' })).toBeInTheDocument()
  })

  it('uses CLI identity and manual group editing when MCP is not configured', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    api.status = vi.fn(async () => ({
      mcpUrl: 'https://example.retool.com/mcp',
      mcpConfigured: false,
      cachedAuth: false,
      connected: false,
      repoDir: '/repo',
      currentUser: { ...currentUser, groups: [] },
    }))
    api.syncCurrentUserFromCli = vi.fn(async () => ({
      currentUser: { ...currentUser, fullName: 'CLI User', firstName: 'CLI', lastName: 'User', email: 'cli@example.com', groups: [] },
    }))
    render(<PanelApp api={api} />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(await screen.findByText('CLI User')).toBeInTheDocument()
    expect(api.syncCurrentUserFromCli).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Edit emulated user' }))
    expect(await screen.findByRole('heading', { name: 'Groups (manual)' })).toBeInTheDocument()
    expect(api.groups).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.type(screen.getByLabelText('Group 1 name'), 'Local Operators')
    await user.click(screen.getByRole('button', { name: 'Save emulated user' }))
    await waitFor(() => expect(api.saveCurrentUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'cli@example.com',
      groups: [{ id: 1, name: 'Local Operators' }],
    })))
  })

  it('keeps MCP groups enabled when an older backend omits the configuration flag', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    api.status = vi.fn(async () => ({
      mcpUrl: 'https://example.retool.com/mcp',
      cachedAuth: true,
      connected: false,
      repoDir: '/repo',
      currentUser,
    }))
    render(<PanelApp api={api} />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(await screen.findByText('Dev User')).toBeInTheDocument()
    expect(api.syncCurrentUserFromCli).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Edit emulated user' }))
    expect(await screen.findByLabelText('Retool groups')).toBeInTheDocument()
    expect(api.groups).toHaveBeenCalledOnce()
  })


  it('shows private local API definitions without exposing their contents', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('tab', { name: /^Local API specs/ }))
    expect(await screen.findByRole('heading', { name: /Local API specs/ })).toBeInTheDocument()
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
    await user.click(screen.getByRole('tab', { name: /^Local API specs/ }))
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
    await user.click(screen.getByRole('tab', { name: /^Local API specs/ }))
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

    await user.click(screen.getByRole('tab', { name: /^Resources/ }))

    expect(await screen.findByText('local — upload.openapi.yaml · #1234567890ab')).toBeInTheDocument()
  })

  it('scans a repository and runs the selected exact worktree read-only', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    const repoInput = await screen.findByLabelText('Local apps parent folder')
    await user.clear(repoInput)
    await user.type(repoInput, '/repo')
    await user.click(screen.getByRole('button', { name: 'Use folder' }))
    await user.click(screen.getByRole('tab', { name: /^Apps/ }))
    await user.selectOptions(await screen.findByLabelText('Source for Example App'), '/worktrees/feature')
    await user.click(screen.getByRole('button', { name: 'Run Example App' }))

    expect(api.run).toHaveBeenCalledWith({
      appPath: '/worktrees/feature/apps-v2/Operations/Example App',
      worktreePath: '/worktrees/feature',
      name: 'Example App',
      branch: 'feature',
      environment: 'staging',
      writes: false,
    })
    expect(await screen.findByRole('link', { name: 'Open preview' })).toHaveAttribute('href', 'http://localhost:5174')
  })

  it('shows missing staging resources as direct Retool links', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    api.run = vi.fn(async () => {
      throw new PanelApiError("Example App can't run in staging.", {
        error: "Example App can't run in staging.",
        missingResources: [
          { name: 'Slack', resourceId: 'slack-id', url: 'https://example.retool.com/resources/slack-id' },
          { name: 'Databricks', resourceId: 'database-id', url: 'https://example.retool.com/resources/database-id' },
        ],
      })
    })
    render(<PanelApp api={api} />)

    await user.click(await screen.findByRole('button', { name: 'Run Example App' }))

    expect(await screen.findByText("Example App can't run in staging.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Slack' })).toHaveAttribute(
      'href',
      'https://example.retool.com/resources/slack-id',
    )
    expect(screen.getByRole('link', { name: 'Databricks' })).toHaveAttribute(
      'href',
      'https://example.retool.com/resources/database-id',
    )
    expect(screen.queryByText('slack-id')).not.toBeInTheDocument()
  })

  it('requires confirmation before starting a production preview', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await user.selectOptions(
      await screen.findByLabelText('Environment for Example App'),
      'production',
    )
    await user.click(screen.getByRole('button', { name: 'Run Example App' }))

    expect(api.run).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('production')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('read-only')

    await user.click(screen.getByRole('button', { name: 'Run in production' }))
    await waitFor(() => expect(api.run).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'production',
      writes: false,
    })))
  })

  it('renders a stale scan payload without worktrees as unavailable instead of crashing', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    const staleApp = { ...exampleApp, worktrees: undefined } as unknown as ScannedApp
    api.scan = vi.fn(async () => ({ apps: [staleApp], repoDir: '/repo', sourceMode: 'cli' as const }))
    render(<PanelApp api={api} />)

    expect(await screen.findByRole('option', { name: 'no app source found' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Example App' })).toBeDisabled()
  })

  it('rescans the saved repository from the Apps page', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    await screen.findByRole('button', { name: 'Run Example App' })
    expect(api.scan).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Rescan' }))

    await waitFor(() => expect(api.scan).toHaveBeenCalledTimes(2))
    expect(api.scan).toHaveBeenLastCalledWith('/repo', 'cli')
  })

  it('requires confirmation before an app can run with writes', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    render(<PanelApp api={api} />)

    const writeSwitch = await screen.findByRole('switch', { name: 'Enable writes for Example App' })
    await user.click(writeSwitch)

    expect(screen.getByRole('alertdialog')).toHaveTextContent('staging')
    expect(writeSwitch).toHaveAttribute('aria-checked', 'false')

    await user.click(screen.getByRole('button', { name: 'Enable writes' }))
    await waitFor(() => expect(writeSwitch).toHaveAttribute('aria-checked', 'true'))
    await user.click(screen.getByRole('button', { name: 'Run Example App' }))

    expect(api.run).toHaveBeenCalledWith(expect.objectContaining({ writes: true }))
  })

  it('filters apps by search, running state, and launches in this panel session', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    const otherApp: ScannedApp = {
      ...exampleApp,
      name: 'Other App',
      path: '/repo/apps-v2/Operations/Other App',
      worktrees: exampleApp.worktrees.map((worktree) => ({
        ...worktree,
        appPath: `${worktree.worktreePath}/apps-v2/Operations/Other App`,
      })),
    }
    api.scan = vi.fn(async () => ({ apps: [exampleApp, otherApp], repoDir: '/repo', sourceMode: 'cli' as const }))
    api.running = vi.fn(async () => ({ apps: [{
      name: 'Example App',
      appPath: exampleApp.path,
      worktreePath: '/worktrees/main',
      branch: 'main',
      head: '1111111111111111111111111111111111111111',
      dirty: false,
      port: 5174,
      url: 'http://localhost:5174',
      environment: 'staging' as const,
      writes: false,
    }] }))

    render(<PanelApp api={api} />)

    const filter = await screen.findByLabelText('Filter apps')
    await user.type(filter, 'Other')
    expect(screen.getByRole('button', { name: 'Run Other App' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run Example App' })).not.toBeInTheDocument()

    await user.clear(filter)
    await user.click(screen.getByRole('button', { name: 'running' }))
    expect(await screen.findByRole('button', { name: 'Run Example App' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run Other App' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'all' }))
    await user.click(await screen.findByRole('button', { name: 'Run Other App' }))
    await user.click(screen.getByRole('button', { name: 'recent' }))
    expect(await screen.findByRole('button', { name: 'Run Other App' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run Example App' })).not.toBeInTheDocument()
  })

  it('shows the exact worktree identity for a running preview', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    api.running = vi.fn(async () => ({
      apps: [{
        name: 'Example App',
        appPath: '/worktrees/feature/apps-v2/Operations/Example App',
        worktreePath: '/worktrees/feature',
        branch: 'arsanymiladext/feature',
        head: '2222222222222222222222222222222222222222',
        dirty: true,
        port: 5174,
        url: 'http://localhost:5174',
        environment: 'staging' as const,
        writes: false,
      }],
    }))

    render(<PanelApp api={api} />)

    const branch = await screen.findByText('arsanymiladext/feature')
    expect(screen.getByText('2222222 · modified')).toBeInTheDocument()
    expect(screen.getByText('staging', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByText('read only')).toBeInTheDocument()
    expect(screen.getByText('/worktrees/feature')).toBeInTheDocument()
    await user.hover(branch)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('arsanymiladext/feature')
  })
})
