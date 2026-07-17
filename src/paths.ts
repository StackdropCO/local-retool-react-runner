import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Derived from this file's location (src/paths.ts -> tool root), so the tool is
// portable: it works wherever the folder is checked out, on any machine.
export const TOOL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// No org/machine assumptions: the MCP URL is per-user. Set it in the panel, via
// `--mcp-url`, or the RETOOL_MCP_URL env var. Empty by default.
export const MCP_URL = process.env.RETOOL_MCP_URL || ''
// Token cache is namespaced per MCP host so multiple Retool orgs don't clash.
export const authDir = (host?: string) =>
  host ? join(TOOL_ROOT, '.mcp-auth', host) : join(TOOL_ROOT, '.mcp-auth')
export const logsDir = () => join(TOOL_ROOT, 'logs')
