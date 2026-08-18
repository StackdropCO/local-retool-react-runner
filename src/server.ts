import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { TOOL_ROOT } from './paths.js'
import { hooksVirtualPlugin } from './vitePlugin.js'
import { readEndpointResourceRefs, readResourceRefs, createRunner, walkTs } from './endpointRunner.js'
import { resolveResources, buildGlobals, validateLocalResourceBindings } from './resourceGlobals.js'
import type { McpClient } from './mcpClient.js'
import { loadLocalResourceDefinitions } from './localResourceConfig.js'

// The app frontend lives outside the tool root, so Vite can't resolve its bare
// npm imports (react, radix, lucide, ...) — those packages are installed in the
// tool's node_modules. Alias every frontend dependency name to the tool copy.
// @rollup/plugin-alias string matching only hits `name` and `name/<subpath>`,
// so this is safe and covers deep imports like `react-dom/client`.
export function buildAppAliases(appDir: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(appDir, 'frontend', 'package.json'), 'utf8'))
  const deps = Object.keys(pkg.dependencies ?? {})
  const alias: Record<string, string> = {}
  // Most-specific first: appEntry always imports '@app/orgTheme.css'; if this
  // app has none, resolve it to an empty stub. Must precede the '@app' prefix.
  if (!existsSync(join(appDir, 'frontend', 'orgTheme.css'))) {
    alias['@app/orgTheme.css'] = join(TOOL_ROOT, 'src', 'empty.css')
  }
  alias['@app'] = join(appDir, 'frontend')
  for (const name of deps) alias[name] = join(TOOL_ROOT, 'node_modules', name)
  return alias
}

export function discoverEndpoints(appDir: string): string[] {
  // Any *.ts under backend/** with a default export is an endpoint.
  return walkTs(join(appDir, 'backend'))
    .filter((f) => /export\s+default/.test(readFileSync(f, 'utf8')))
    .map((f) => f.replace(/\.ts$/, '').split('/').pop() as string)
}

// Databricks/Lakebase .query() already returns {data}; the probe confirmed
// execute_resource_ts unwraps to that same shape, so identity is correct.
const normalize = (raw: unknown) => raw

export async function startServer(opts: { appDir: string; port: number; writes: boolean; mcp: McpClient }) {
  const endpoints = discoverEndpoints(opts.appDir)
  const refsByEndpoint = readEndpointResourceRefs(opts.appDir)
  const refs = readResourceRefs(opts.appDir)
  const backendFiles = walkTs(join(opts.appDir, 'backend'))
  const map = await resolveResources(opts.mcp, refs, backendFiles.map((file) => readFileSync(file, 'utf8')))
  const localResources = loadLocalResourceDefinitions({ appResourceIds: new Set(refs.map((ref) => ref.name)) })
  validateLocalResourceBindings(map, localResources)
  for (const definition of Object.values(localResources)) {
    console.log(
      `[local-resource] ${definition.binding} (${definition.resourceId}) ` +
        `${definition.specPath} #${definition.specHash.slice(0, 12)}`,
    )
  }

  const app = express()
  app.use(express.json({ limit: '10mb' }))

  app.post('/rpc/:endpoint', async (req, res) => {
    const endpoint = req.params.endpoint
    const endpointResourceIds = new Set((refsByEndpoint[endpoint] ?? []).map((ref) => ref.name))
    const endpointMap = Object.fromEntries(
      Object.entries(map).filter(([resourceId]) => endpointResourceIds.has(resourceId)),
    )
    const endpointLocalResources = Object.fromEntries(
      Object.entries(localResources).filter(([resourceId]) => endpointResourceIds.has(resourceId)),
    )
    const globals = buildGlobals(opts.mcp, endpointMap, {
      writes: opts.writes,
      endpoint,
      normalize,
      localResources: endpointLocalResources,
    })
    const runner = createRunner({ appDir: opts.appDir, globals })
    try {
      const result = await runner.run(endpoint, req.body?.params ?? {})
      res.json({ result })
    } catch (err: any) {
      res.status(400).json({ __error: true, error: String(err?.message ?? err) })
    }
  })

  const vite = await createViteServer({
    root: TOOL_ROOT,
    appType: 'custom',
    // Unique HMR ws port per app so several runners can run at once (the panel
    // launches multiple). Derived from the app port to avoid collisions.
    server: { middlewareMode: true, hmr: { port: opts.port + 3000 } },
    plugins: [react(), hooksVirtualPlugin({ appDir: opts.appDir, endpoints })],
    resolve: { alias: buildAppAliases(opts.appDir), dedupe: ['react', 'react-dom'] },
  })
  app.use(vite.middlewares)

  // SPA fallback: serve the transformed index.html for any non-asset GET.
  app.use(async (req, res, next) => {
    if (req.method !== 'GET') return next()
    try {
      const html = await vite.transformIndexHtml(req.originalUrl, readFileSync(join(TOOL_ROOT, 'index.html'), 'utf8'))
      res.status(200).set({ 'content-type': 'text/html' }).end(html)
    } catch (e) {
      vite.ssrFixStacktrace?.(e as Error)
      next(e)
    }
  })

  return await new Promise<{ url: string; close(): Promise<void> }>((resolve) => {
    const server = app.listen(opts.port, () => {
      resolve({
        url: `http://localhost:${opts.port}`,
        close: async () => {
          await vite.close()
          server.close()
        },
      })
    })
  })
}
