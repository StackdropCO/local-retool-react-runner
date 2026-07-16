import type { Plugin } from 'vite'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function hookModuleSource(endpoints: string[], rpcBase: string): string {
  const post = `
async function post(path, params) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ params }) })
  const json = await res.json()
  if (!res.ok || json?.__error) throw new Error(json?.error || ('HTTP ' + res.status))
  return json.result
}`
  const hooks = endpoints
    .map(
      (e) => `export function use${cap(e)}() {
  return { trigger: (params, _opts) => ({ result: post('${rpcBase}/${e}', params) }) }
}`,
    )
    .join('\n\n')
  return `${post}\n\n${hooks}\n`
}

export function hooksVirtualPlugin(opts: { appDir: string; endpoints: string[]; rpcBase?: string }): Plugin {
  const rpcBase = opts.rpcBase ?? '/rpc'
  const marker = 'hooks/backend/shift'
  const virtualId = '\0virtual:' + marker
  return {
    name: 'local-mcp-runner-hooks',
    resolveId(id) {
      if (id.endsWith(marker) || id.endsWith(marker + '.ts') || id.endsWith(marker + '.tsx')) return virtualId
      return null
    },
    load(id) {
      if (id === virtualId) return hookModuleSource(opts.endpoints, rpcBase)
      return null
    },
  }
}
