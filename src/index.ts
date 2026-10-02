import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readConfig } from './config.js'
import { connectRetoolCli } from './cliClient.js'
import { createAutoClient } from './autoClient.js'
import { connectMcp, hasCachedAuth } from './mcpClient.js'
import { startServer } from './server.js'
import { ensureFrontendDeps } from './deps.js'
import { repoRoot, validateWorktreeTarget } from './git.js'
import { resolveAppDirectory } from './scan.js'
import { parseRetoolEnvironment } from './environment.js'
import { resolveCurrentUser } from './currentUser.js'
import { MCP_URL } from './paths.js'

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const has = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const config = readConfig()
  const requestedApp = arg('app', '')!
  const port = Number(arg('port', '5174'))
  const writes = has('writes')
  const environmentName = parseRetoolEnvironment(arg('environment', 'staging'))
  const branch = arg('branch', '')!
  const exploreCheckoutDir = arg('checkout', arg('explore-checkout', config.exploreCheckoutDir || ''))!
  let appDir = requestedApp
  try {
    appDir = resolveAppDirectory(exploreCheckoutDir, requestedApp)
  } catch (error) {
    console.error(`[runner] ${String((error as Error)?.message ?? error)}`)
    process.exit(1)
  }
  if (branch && appDir) {
    const worktreePath = repoRoot(appDir)
    if (!worktreePath) throw new Error(`app is not inside a Git worktree: ${appDir}`)
    validateWorktreeTarget(appDir, worktreePath, branch)
    console.log(`[runner] branch=${branch}`)
  }
  if (!appDir || !existsSync(join(appDir, 'frontend', 'App.tsx'))) {
    console.error(
      `[runner] no app found${appDir ? ` at:\n  ${appDir}` : ' (no --app given)'}\n` +
        `Pass --checkout "/path/to/retool-checkout" and optionally --app "Group/App", or use the panel: pnpm panel`,
    )
    process.exit(1)
  }
  if (!exploreCheckoutDir) {
    console.error('[runner] no Retool CLI checkout. Pass --checkout "/abs/path/to/retool-clone" or configure exploreCheckoutDir.')
    process.exit(1)
  }
  console.log(`[runner] app=${appDir}`)
  console.log(`[runner] environment=${environmentName}`)
  console.log(`[runner] mode=${writes ? 'READ-WRITE' : 'read-only'} (use --writes to enable writes)`)
  if (exploreCheckoutDir) console.log(`[runner] retool-explore=${exploreCheckoutDir}`)
  ensureFrontendDeps(appDir)
  const cli = await connectRetoolCli(exploreCheckoutDir, { allowMutative: writes })
  const mcpUrl = arg('mcp-url', config.mcpUrl || MCP_URL)!
  let resources = cli
  if (mcpUrl && hasCachedAuth(mcpUrl)) {
    try {
      const mcp = await connectMcp(mcpUrl)
      resources = createAutoClient(cli, mcp)
      console.log('[runner] transport=auto (safe reads: MCP; writes/ambiguous: Retool CLI)')
    } catch (error) {
      console.warn(`[runner] MCP unavailable before startup; using Retool CLI: ${String((error as Error)?.message ?? error)}`)
      console.log('[runner] transport=retool-cli')
    }
  } else {
    console.log('[runner] transport=retool-cli (authorize MCP in Settings to enable auto routing)')
  }
  const { url } = await startServer({
    appDir,
    port,
    writes,
    environmentName,
    mcp: resources,
    exploreCheckoutDir,
    // Read on each request so changing the persona in the panel does not
    // require restarting backend query execution.
    currentUser: () => resolveCurrentUser(readConfig().currentUser),
  })
  console.log(`[runner] serving ${url}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
