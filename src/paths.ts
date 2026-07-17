import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Derived from this file's location (src/paths.ts -> tool root), so the tool is
// portable: it works wherever the folder is checked out, on any machine.
export const TOOL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// Convenience default: assumes `retool-ops` sits next to this tool (…/Projects/
// retool-ops and …/Projects/local-mcp-runner). Override with `--app` for any
// other location; index.ts errors clearly if the path doesn't exist.
export const DEFAULT_APP_DIR = join(
  dirname(TOOL_ROOT),
  'retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard',
)

export const MCP_URL = process.env.RETOOL_MCP_URL || 'https://ops.wayve.retool.com/mcp'
// Token cache is namespaced per MCP host so multiple Retool orgs don't clash.
export const authDir = (host?: string) =>
  host ? join(TOOL_ROOT, '.mcp-auth', host) : join(TOOL_ROOT, '.mcp-auth')
export const logsDir = () => join(TOOL_ROOT, 'logs')
