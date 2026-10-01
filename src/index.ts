import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readConfig } from './config.js'
import { connectRetoolCli } from './cliClient.js'
import { startServer } from './server.js'
import { ensureFrontendDeps } from './deps.js'
import { repoRoot, validateWorktreeTarget } from './git.js'
import { resolveAppDirectory } from './scan.js'
import { parseRetoolEnvironment } from './environment.js'
import { resolveCurrentUser } from './currentUser.js'

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
  console.log('[runner] transport=retool-cli (MCP disabled)')
  console.log(`[runner] environment=${environmentName}`)
  console.log(`[runner] mode=${writes ? 'READ-WRITE' : 'read-only'} (use --writes to enable writes)`)
  if (exploreCheckoutDir) console.log(`[runner] retool-explore=${exploreCheckoutDir}`)
  ensureFrontendDeps(appDir)
  const mcp = await connectRetoolCli(exploreCheckoutDir, { allowMutative: writes })
  const { url } = await startServer({
    appDir,
    port,
    writes,
    environmentName,
    mcp,
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
