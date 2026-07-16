import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { MCP_URL } from './paths.js'
import { FileOAuthProvider, waitForCallback } from './oauthProvider.js'

export type ResourceBinding = { resource_id: string; variable_name: string; type: string; display_name?: string }

export type McpClient = {
  executeResourceTs(resourceNames: string[], code: string, environmentName?: string): Promise<unknown>
  getResourceBindings(resourceNames: string[]): Promise<ResourceBinding[]>
  listResources(nameContains?: string): Promise<Array<{ name: string; displayName?: string; type?: string }>>
  close(): Promise<void>
}

function textParts(result: any): string[] {
  const c = result?.content
  if (Array.isArray(c)) return c.filter((p: any) => p?.type === 'text').map((p: any) => p.text as string)
  return [typeof result === 'string' ? result : JSON.stringify(result)]
}

function textOf(result: any): string {
  return textParts(result).join('\n')
}

// Retool MCP tools often return a status line ("Status: completed...") plus a
// separate JSON payload part. Pick the part that parses as JSON; otherwise fall
// back to the joined text.
function parseResult(result: any): unknown {
  const parts = textParts(result)
  for (let i = parts.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(parts[i])
    } catch {
      /* not this part */
    }
  }
  return parts.join('\n')
}

export async function connectMcp(): Promise<McpClient> {
  const authProvider = new FileOAuthProvider()
  const client = new Client({ name: 'local-mcp-runner', version: '0.1.0' }, { capabilities: {} })
  const newTransport = () => new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider })

  try {
    await client.connect(newTransport())
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e
    // The first transport was started (and torn down) during the failed auth
    // handshake; the SDK forbids reusing it. Exchange the code on a fresh
    // transport, then connect with another fresh transport using saved tokens.
    const authTransport = newTransport()
    const code = await waitForCallback() // browser was opened by the provider
    await authTransport.finishAuth(code)
    await client.connect(newTransport())
  }

  const call = async (name: string, args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name, arguments: args })
    if (res?.isError) throw new Error(textOf(res) || `MCP tool ${name} returned an error`)
    return parseResult(res)
  }

  return {
    async executeResourceTs(resourceNames, code, environmentName) {
      // execute_resource_ts wraps the snippet's return value: {success, data, error, logs}.
      const r: any = await call('retool_execute_resource_ts', {
        resourceNames,
        code,
        ...(environmentName ? { environmentName } : {}),
      })
      if (r && typeof r === 'object' && 'success' in r) {
        if (!r.success) throw new Error(String(r.error ?? 'execute_resource_ts failed'))
        return r.data
      }
      return r
    },
    async getResourceBindings(resourceNames) {
      const r: any = await call('retool_get_resource_ts_definitions', { resourceNames })
      const bindings = r?.data?.bindings ?? r?.bindings ?? []
      return bindings as ResourceBinding[]
    },
    async listResources(nameContains) {
      const r: any = await call('retool_list_resources', {
        limit: 100,
        ...(nameContains ? { name_contains: nameContains } : {}),
      })
      const arr = Array.isArray(r) ? r : (r?.resources ?? r?.data ?? [])
      return arr.map((x: any) => ({
        name: x.name,
        displayName: x.displayName ?? x.display_name,
        type: x.type ?? x.resource_type,
      }))
    },
    async close() {
      await client.close()
    },
  }
}
