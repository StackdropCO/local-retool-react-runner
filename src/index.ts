import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MCP_URL } from './paths.js'
import { readConfig } from './config.js'
import { connectMcp } from './mcpClient.js'
import { startServer } from './server.js'
import { ensureFrontendDeps } from './deps.js'
import { repoRoot, validateWorktreeTarget } from './git.js'

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const has = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  let appDir = arg('app', '')!
  const port = Number(arg('port', '5174'))
  const writes = has('writes')
  const branch = arg('branch', '')!
  // Which Retool environment resource calls execute against. Without it every call
  // lands on the MCP's default environment, which is production on most orgs.
  const environmentName = arg('environment', '')!
  if (branch && appDir) {
    const worktreePath = repoRoot(appDir)
    if (!worktreePath) throw new Error(`app is not inside a Git worktree: ${appDir}`)
    validateWorktreeTarget(appDir, worktreePath, branch)
    console.log(`[runner] branch=${branch}`)
  }
  if (!appDir || !existsSync(join(appDir, 'frontend', 'App.tsx'))) {
    console.error(
      `[runner] no app found${appDir ? ` at:\n  ${appDir}` : ' (no --app given)'}\n` +
        `Pass --app "/abs/path/to/an/apps-v2/app", or use the panel: pnpm panel`,
    )
    process.exit(1)
  }
  // MCP URL is per-user: flag > saved config > env. No org default.
  const mcpUrl = arg('mcp-url', readConfig().mcpUrl || MCP_URL)!
  if (!mcpUrl) {
    console.error('[runner] no MCP URL. Pass --mcp-url "https://your-org.retool.com/mcp", set RETOOL_MCP_URL, or configure it in the panel (pnpm panel).')
    process.exit(1)
  }
  console.log(`[runner] app=${appDir}`)
  console.log(`[runner] mcp=${mcpUrl}`)
  console.log(`[runner] mode=${writes ? 'READ-WRITE' : 'read-only'} (use --writes to enable writes)`)
  console.log(`[runner] environment=${environmentName || 'MCP default'}`)
  ensureFrontendDeps(appDir)
  const mcp = await connectMcp(mcpUrl)
  const { url } = await startServer({
    appDir,
    port,
    writes,
    mcp,
    ...(environmentName ? { environmentName } : {}),
  })
  console.log(`[runner] serving ${url}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
