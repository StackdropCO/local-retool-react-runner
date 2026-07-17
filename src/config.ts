import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { TOOL_ROOT } from './paths.js'

// Small persisted config (git-ignored) so the MCP URL and last-used repo dir
// survive restarts and page reloads. Tokens live separately under .mcp-auth/.
export type Config = { mcpUrl?: string; repoDir?: string }

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
