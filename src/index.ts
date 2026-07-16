import { DEFAULT_APP_DIR } from './paths.js'
import { connectMcp } from './mcpClient.js'
import { startServer } from './server.js'

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const has = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const appDir = arg('app', DEFAULT_APP_DIR)!
  const port = Number(arg('port', '5174'))
  const writes = has('writes')
  console.log(`[runner] app=${appDir}`)
  console.log(`[runner] mode=${writes ? 'READ-WRITE' : 'read-only'} (use --writes to enable writes)`)
  const mcp = await connectMcp()
  const { url } = await startServer({ appDir, port, writes, mcp })
  console.log(`[runner] serving ${url}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
