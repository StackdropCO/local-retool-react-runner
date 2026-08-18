import type {
  BrowseResult,
  PanelStatus,
  LocalResourceSpec,
  Resource,
  RunningApp,
  RunInput,
  RunResult,
  ScannedApp,
} from './types'

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
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
  resources(): Promise<{ resources: Resource[] }>
  loadLocalResourceSpec(resourceId: string): Promise<LocalResourceSpec>
  saveLocalResourceSpec(resourceId: string, content: string): Promise<LocalResourceSpec>
  browse(dir: string): Promise<BrowseResult>
  scan(repoDir: string): Promise<{ apps: ScannedApp[]; repoDir: string }>
  run(input: RunInput): Promise<RunResult>
  running(): Promise<{ apps: RunningApp[] }>
  stop(port: number): Promise<{ stopped: number }>
}

export const createPanelApi = (): PanelApi => ({
  status: () => request<PanelStatus>('/api/status'),
  saveMcpUrl: (mcpUrl) => post('/api/mcp-url', { mcpUrl }),
  authorize: () => post('/api/auth'),
  resources: () => request('/api/resources'),
  loadLocalResourceSpec: (resourceId) => request(`/api/local-resources/${encodeURIComponent(resourceId)}/spec`),
  saveLocalResourceSpec: (resourceId, content) => request(`/api/local-resources/${encodeURIComponent(resourceId)}/spec`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }),
  browse: (dir) => request(`/api/browse?dir=${encodeURIComponent(dir)}`),
  scan: (repoDir) => post('/api/scan', { repoDir }),
  run: (input) => post('/api/run', input),
  running: () => request('/api/running'),
  stop: (port) => post('/api/stop', { port }),
})

export const panelApi = createPanelApi()
