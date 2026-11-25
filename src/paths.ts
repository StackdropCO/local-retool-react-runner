import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Derived from this file's location (src/paths.ts -> tool root), so the tool is
// portable: it works wherever the folder is checked out, on any machine.
export const TOOL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// Retool generates frontend/lib/shadcn when it builds an app, so it isn't in
// git. Apps that don't have a local copy fall back to this vendored one.
export const VENDORED_SHADCN_DIR = join(TOOL_ROOT, 'vendor', 'retool-shadcn')
const SHADCN_IMPORT = /(?:^|\/)lib\/shadcn\/([a-z0-9-]+)$/

// Returns the vendored file for a lib/shadcn import the app can't resolve itself.
export function vendoredShadcnFile(moduleName: string, containingFile: string): string | undefined {
  const match = SHADCN_IMPORT.exec(moduleName.replace(/\\/g, '/'))
  if (!match || !moduleName.startsWith('.')) return undefined
  const appFile = join(dirname(containingFile), moduleName)
  if (['.tsx', '.ts'].some((extension) => existsSync(appFile + extension))) return undefined
  const vendored = ['.tsx', '.ts'].map((extension) => join(VENDORED_SHADCN_DIR, match[1] + extension)).find((file) => existsSync(file))
  return vendored
}

// No org/machine assumptions: the MCP URL is per-user. Set it in the panel, via
// `--mcp-url`, or the RETOOL_MCP_URL env var. Empty by default.
export const MCP_URL = process.env.RETOOL_MCP_URL || ''
// Token cache is namespaced per MCP host so multiple Retool orgs don't clash.
export const authDir = (host?: string) =>
  host ? join(TOOL_ROOT, '.mcp-auth', host) : join(TOOL_ROOT, '.mcp-auth')
export const logsDir = () => join(TOOL_ROOT, 'logs')
