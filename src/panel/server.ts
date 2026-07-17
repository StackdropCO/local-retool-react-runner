import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { TOOL_ROOT, MCP_URL } from '../paths.js'
import { connectMcp, hasCachedAuth, type McpClient } from '../mcpClient.js'
import { scanApps } from '../scan.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const tsxBin = join(TOOL_ROOT, 'node_modules', '.bin', 'tsx')

// Retool resource types the connector can query through execute_resource_ts.
const READABLE_TYPES = new Set([
  'databricks',
  'databricksLakebase',
  'postgresql',
  'mysql',
  'sqlserver',
  'snowflake',
  'redshift',
  'bigquery',
  'restapi', // only if OpenAPI-annotated — flagged as "maybe" below
])

type Running = { appPath: string; name: string; port: number; url: string; writes: boolean; child: ChildProcess }

export function startPanel(port: number) {
  let mcpUrl = MCP_URL
  let mcp: McpClient | null = null
  const running = new Map<number, Running>()

  const app = express()
  app.use(express.json())

  app.get('/', (_req, res) => res.type('html').send(readFileSync(join(HERE, 'index.html'), 'utf8')))

  app.get('/api/status', (_req, res) => {
    res.json({ mcpUrl, cachedAuth: hasCachedAuth(mcpUrl), connected: !!mcp })
  })

  // Set the MCP URL (does not connect). Clears any existing connection.
  app.post('/api/mcp-url', async (req, res) => {
    const next = String(req.body?.mcpUrl || '').trim()
    try {
      new URL(next)
    } catch {
      return res.status(400).json({ error: 'invalid URL' })
    }
    if (mcp) {
      await mcp.close().catch(() => {})
      mcp = null
    }
    mcpUrl = next
    res.json({ mcpUrl, cachedAuth: hasCachedAuth(mcpUrl) })
  })

  // Connect + OAuth. Opens a browser on first auth; uses cached tokens otherwise.
  app.post('/api/auth', async (_req, res) => {
    try {
      if (!mcp) mcp = await connectMcp(mcpUrl)
      res.json({ connected: true, mcpUrl })
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) })
    }
  })

  app.get('/api/resources', async (_req, res) => {
    try {
      if (!mcp) mcp = await connectMcp(mcpUrl)
      const list = await mcp.listResources()
      const resources = list
        .map((r) => ({
          name: r.name,
          displayName: r.displayName ?? r.name,
          type: r.type ?? 'unknown',
          readable: READABLE_TYPES.has(r.type ?? ''),
          note: r.type === 'restapi' ? 'only if OpenAPI-annotated' : '',
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
      res.json({ resources })
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) })
    }
  })

  app.post('/api/scan', (req, res) => {
    const repoDir = String(req.body?.repoDir || '').trim()
    if (!repoDir) return res.status(400).json({ error: 'repoDir required' })
    try {
      res.json({ apps: scanApps(repoDir) })
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) })
    }
  })

  const nextPort = () => {
    let p = 5174
    while (running.has(p)) p++
    return p
  }

  app.post('/api/run', (req, res) => {
    const appPath = String(req.body?.appPath || '').trim()
    const name = String(req.body?.name || appPath.split('/').pop() || 'app')
    const writes = !!req.body?.writes
    if (!appPath) return res.status(400).json({ error: 'appPath required' })
    const p = nextPort()
    const args = ['src/index.ts', '--app', appPath, '--port', String(p), '--mcp-url', mcpUrl]
    if (writes) args.push('--writes')
    const child = spawn(tsxBin, args, { cwd: TOOL_ROOT, env: process.env })
    const url = `http://localhost:${p}`
    let settled = false
    const done = (body: any, code = 200) => {
      if (settled) return
      settled = true
      res.status(code).json(body)
    }
    child.stdout.on('data', (b) => {
      const s = b.toString()
      process.stdout.write(`[app:${p}] ${s}`)
      if (s.includes('serving')) {
        running.set(p, { appPath, name, port: p, url, writes, child })
        done({ port: p, url, name, writes })
      }
    })
    child.stderr.on('data', (b) => process.stderr.write(`[app:${p}] ${b}`))
    child.on('exit', (code) => {
      running.delete(p)
      done({ error: `runner exited (code ${code}) before serving` }, 400)
    })
    setTimeout(() => done({ port: p, url, name, writes, warning: 'started; not confirmed serving yet' }), 45000)
  })

  app.get('/api/running', (_req, res) => {
    res.json({
      apps: [...running.values()].map(({ name, appPath, port, url, writes }) => ({ name, appPath, port, url, writes })),
    })
  })

  app.post('/api/stop', (req, res) => {
    const p = Number(req.body?.port)
    const r = running.get(p)
    if (!r) return res.status(404).json({ error: 'not running' })
    r.child.kill('SIGTERM')
    running.delete(p)
    res.json({ stopped: p })
  })

  const server = app.listen(port, () => console.log(`[panel] control panel: http://localhost:${port}`))
  process.on('SIGINT', () => {
    for (const r of running.values()) r.child.kill('SIGTERM')
    server.close()
    process.exit(0)
  })
}
