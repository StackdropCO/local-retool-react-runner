import type { Plugin } from 'vite'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function hookModuleSource(endpoints: string[], rpcBase: string): string {
  const head = `import { useState } from 'react'

async function post(path, params) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ params }) })
  const json = await res.json()
  if (!res.ok || json?.__error) throw new Error(json?.error || ('HTTP ' + res.status))
  return json.result
}`
  // Stateful query/mutation hook: exposes reactive .data/.isFetching/.error
  // (read directly by some apps) AND .trigger(params).result (a Promise).
  const hooks = endpoints
    .map(
      (e) => `export function use${cap(e)}() {
  const [state, setState] = useState({ data: undefined, isFetching: false, error: undefined })
  return {
    data: state.data,
    isFetching: state.isFetching,
    error: state.error,
    trigger: (params, _opts) => {
      setState((s) => ({ ...s, isFetching: true }))
      const result = post('${rpcBase}/${e}', params)
        .then((d) => { setState({ data: d, isFetching: false, error: undefined }); return d })
        .catch((err) => { setState((s) => ({ ...s, isFetching: false, error: String((err && err.message) || err) })); throw err })
      return { result: result }
    },
  }
}`,
    )
    .join('\n\n')
  return `${head}\n\n${hooks}\n`
}

export function hooksVirtualPlugin(opts: { appDir: string; endpoints: string[]; rpcBase?: string }): Plugin {
  const rpcBase = opts.rpcBase ?? '/rpc'
  // Match any app's generated backend hooks import: ./hooks/backend/<group>.
  const marker = /(^|\/)hooks\/backend\/[^/]+$/
  const virtualId = '\0virtual:local-mcp-runner-hooks'
  return {
    name: 'local-mcp-runner-hooks',
    resolveId(id) {
      const clean = id.replace(/\.tsx?$/, '')
      if (marker.test(clean)) return virtualId
      return null
    },
    load(id) {
      if (id === virtualId) return hookModuleSource(opts.endpoints, rpcBase)
      return null
    },
  }
}
