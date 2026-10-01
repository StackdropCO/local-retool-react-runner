import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { TOOL_ROOT } from './paths.js'
import type { CurrentUser } from './currentUser.js'

// Small persisted config (git-ignored) so the CLI checkout and last-used app
// source directory survive restarts and page reloads.
export type Config = {
  mcpUrl?: string
  repoDir?: string
  /** Parent folder containing standalone Retool CLI checkouts. */
  cliAppsDir?: string
  /** Apps as Code repository used for protected Git-backed apps. */
  gitRepoDir?: string
  sourceMode?: 'cli' | 'git'
  currentUser?: CurrentUser
  /** A `retool clone` checkout used for app source and resource execution. */
  exploreCheckoutDir?: string
}

const FILE = join(TOOL_ROOT, 'config.json')

export function readConfig(file: string = FILE): Config {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  } catch {
    return {}
  }
}

export function writeConfig(patch: Config, file: string = FILE): Config {
  const next = { ...readConfig(file), ...patch }
  writeFileSync(file, JSON.stringify(next, null, 2))
  return next
}
