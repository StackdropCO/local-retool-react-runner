export interface PanelStatus {
  mcpUrl: string
  cachedAuth: boolean
  connected: boolean
  repoDir: string
  localResources?: LocalResourceSummary[]
  localResourceError?: string
}

export interface LocalResourceSummary {
  resourceId: string
  binding: string
  specFile: string
  specHash: string
}

export interface LocalResourceSpec extends LocalResourceSummary {
  content: string
}

export interface Resource {
  name: string
  displayName: string
  type: string
  readable: boolean
  localConfigured?: boolean
  note: string
}

export interface ScannedApp {
  name: string
  group: string
  path: string
  branch: string | null
  branches: string[]
  worktrees: AppWorktree[]
  endpoints: string[]
  resources: Array<{ displayName: string; type: string }>
}

export interface AppWorktree {
  worktreePath: string
  appPath: string
  branch: string | null
  head: string
  dirty: boolean
}

export interface RunningApp {
  name: string
  appPath: string
  worktreePath: string
  branch: string
  head: string
  dirty: boolean
  port: number
  url: string
  environment: 'staging' | 'production'
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
  worktreePath: string
  name: string
  branch: string
  environment: 'staging' | 'production'
  writes: boolean
}

export interface RunResult {
  port: number
  url: string
  name?: string
  branch?: string
  worktreePath?: string
  head?: string
  dirty?: boolean
  environment?: 'staging' | 'production'
  writes?: boolean
  alreadyRunning?: boolean
  warning?: string
}
