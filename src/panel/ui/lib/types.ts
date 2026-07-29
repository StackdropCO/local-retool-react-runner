export interface PanelStatus {
  mcpUrl: string
  cachedAuth: boolean
  connected: boolean
  repoDir: string
}

export interface Resource {
  name: string
  displayName: string
  type: string
  readable: boolean
  note: string
}

export interface ScannedApp {
  name: string
  group: string
  path: string
  branch: string | null
  branches: string[]
  endpoints: string[]
  resources: Array<{ displayName: string; type: string }>
}

export interface RunningApp {
  name: string
  appPath: string
  branch: string
  port: number
  url: string
  writes: boolean
}

export interface BrowseResult {
  dir: string
  parent: string | null
  dirs: string[]
  isRepo: boolean
}

export interface RunInput {
  appPath: string
  name: string
  branch: string
  writes: boolean
}

export interface RunResult {
  port: number
  url: string
  name?: string
  branch?: string
  writes?: boolean
  alreadyRunning?: boolean
  warning?: string
}

