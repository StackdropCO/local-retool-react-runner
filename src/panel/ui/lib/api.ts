import type {
  BrowseResult,
  PanelStatus,
  LocalResourceSpec,
  Resource,
  RunningApp,
  RunInput,
  RunResult,
  ScannedApp,
  CurrentUser,
  RetoolGroup,
  RetoolCliStatus,
  RetoolCliApp,
} from './types'

export type MissingRetoolResource = {
  name: string
  resourceId: string
  url: string
}

export type PanelApiErrorDetails = {
  error?: string
  missingResources?: MissingRetoolResource[]
}

export class PanelApiError extends Error {
  constructor(message: string, readonly details: PanelApiErrorDetails) {
    super(message)
    this.name = 'PanelApiError'
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = response.status === 404 && path.startsWith('/api/cli/')
      ? 'This panel backend does not support Retool CLI actions yet. Stop it, restart `pnpm panel`, then reload this page.'
      : typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`
    throw new PanelApiError(
      message,
      body,
    )
  }
  return body as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export interface PanelApi {
  status(): Promise<PanelStatus>
  saveMcpUrl(mcpUrl: string): Promise<{ mcpUrl: string; cachedAuth: boolean }>
  authorize(): Promise<{ connected: true; mcpUrl: string }>
  groups(): Promise<{ groups: RetoolGroup[] }>
  saveCurrentUser(currentUser: CurrentUser): Promise<{ currentUser: CurrentUser }>
  syncCurrentUserFromCli(): Promise<{ currentUser: CurrentUser }>
  resources(): Promise<{ resources: Resource[] }>
  loadLocalResourceSpec(resourceId: string): Promise<LocalResourceSpec>
  saveLocalResourceSpec(resourceId: string, content: string): Promise<LocalResourceSpec>
  browse(dir: string): Promise<BrowseResult>
  scan(repoDir: string, sourceMode?: 'cli' | 'git'): Promise<{ apps: ScannedApp[]; repoDir: string; sourceMode: 'cli' | 'git' }>
  run(input: RunInput): Promise<RunResult>
  running(): Promise<{ apps: RunningApp[] }>
  stop(port: number): Promise<{ stopped: number }>
  cliStatus(): Promise<{ status: RetoolCliStatus; version?: string }>
  cliLogin(host?: string): Promise<{ status: RetoolCliStatus; version?: string }>
  cliApps(host?: string): Promise<{ apps: RetoolCliApp[] | unknown }>
  cliClone(input: { appId: string; parentDir: string; branch?: string; host?: string }): Promise<{ result: unknown; checkoutDir: string; appsRootDir: string }>
  cliPull(checkoutDir: string): Promise<{ result: unknown }>
  cliPush(checkoutDir: string, message: string, confirmed: true): Promise<{ result: unknown }>
}

export const createPanelApi = (): PanelApi => ({
  status: () => request<PanelStatus>('/api/status'),
  saveMcpUrl: (mcpUrl) => post('/api/mcp-url', { mcpUrl }),
  authorize: () => post('/api/auth'),
  groups: () => request('/api/groups'),
  saveCurrentUser: (currentUser) => request('/api/current-user', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentUser }),
  }),
  syncCurrentUserFromCli: () => post('/api/current-user/from-cli'),
  resources: () => request('/api/resources'),
  loadLocalResourceSpec: (resourceId) => request(`/api/local-resources/${encodeURIComponent(resourceId)}/spec`),
  saveLocalResourceSpec: (resourceId, content) => request(`/api/local-resources/${encodeURIComponent(resourceId)}/spec`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }),
  browse: (dir) => request(`/api/browse?dir=${encodeURIComponent(dir)}`),
  scan: (repoDir, sourceMode = 'cli') => post('/api/scan', { repoDir, sourceMode }),
  run: (input) => post('/api/run', input),
  running: () => request('/api/running'),
  stop: (port) => post('/api/stop', { port }),
  cliStatus: () => request('/api/cli/status'),
  cliLogin: (host) => post('/api/cli/login', { host }),
  cliApps: (host) => request(`/api/cli/apps${host ? `?host=${encodeURIComponent(host)}` : ''}`),
  cliClone: (input) => post('/api/cli/clone', input),
  cliPull: (checkoutDir) => post('/api/cli/pull', { checkoutDir }),
  cliPush: (checkoutDir, message, confirmed) => post('/api/cli/push', { checkoutDir, message, confirmed }),
})

export const panelApi = createPanelApi()
