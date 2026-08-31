import { spawn, type ChildProcess } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import express from 'express'
import { createServer as createViteServer } from 'vite'
import { TOOL_ROOT, MCP_URL } from '../paths.js'
import { connectMcp, hasCachedAuth, type McpClient } from '../mcpClient.js'
import { scanApps } from '../scan.js'
import { readConfig, writeConfig } from '../config.js'
import { validateWorktreeTarget } from '../git.js'
import { loadLocalResourceDefinitions, loadLocalResourceEntries } from '../localResourceConfig.js'
import { readLocalResourceSpec, saveLocalResourceSpec } from '../localResourceSpecStore.js'
import { parseRetoolEnvironment, type RetoolEnvironment } from '../environment.js'
import { readResourceRefs } from '../endpointRunner.js'
import type { ResourceRef } from '../resourceGlobals.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const tsxBin = join(TOOL_ROOT, 'node_modules', '.bin', 'tsx')
let panelInstanceId = 0

export function panelViteCacheDir(port: number, instanceId: number): string {
  const name = port > 0 ? `panel-${port}` : `panel-test-${process.pid}-${instanceId}`
  return join(TOOL_ROOT, 'node_modules', '.vite', name)
}

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

type Running = {
  appPath: string
  worktreePath: string
  branch: string
  head: string
  dirty: boolean
  name: string
  port: number
  url: string
  environment: RetoolEnvironment
  writes: boolean
  child: ChildProcess
}

export function buildRunnerArgs(input: {
  appPath: string
  port: number
  mcpUrl: string
  environment: RetoolEnvironment
  writes: boolean
}): string[] {
  const args = [
    'src/dev.ts',
    '--app', input.appPath,
    '--port', String(input.port),
    '--mcp-url', input.mcpUrl,
    '--environment', input.environment,
  ]
  if (input.writes) args.push('--writes')
  return args
}

export function runnerExitResponse(
  name: string,
  environment: RetoolEnvironment,
  code: number | null,
  stderr: string,
  resources: ResourceRef[],
  mcpUrl: string,
): { error: string; missingResources?: Array<{ name: string; resourceId: string; url: string }> } {
  const stderrLines = stderr
    .split('\n')
    .map((line) => line.trim())
  const errorLine = stderrLines
    .find((line) => line.startsWith('Error:') && line.includes(`${environment} environment`))
  if (!errorLine) {
    const unexpectedError = stderrLines.find((line) => line.startsWith('Error:'))
    return {
      error: unexpectedError
        ? `${name} did not start in ${environment}: ${unexpectedError.replace(/^Error:\s*/, '')}`
        : `${name} did not start in ${environment}: runner exited (code ${code}) before serving`,
    }
  }

  const origin = new URL(mcpUrl).origin
  const missingResources = resources
    .filter((resource) => errorLine.includes(resource.name))
    .map((resource) => ({
      name: resource.displayName,
      resourceId: resource.name,
      url: `${origin}/resources/${encodeURIComponent(resource.name)}`,
    }))
  if (!missingResources.length) {
    return { error: `${name} did not start in ${environment}: ${errorLine.replace(/^Error:\s*/, '')}` }
  }
  return {
    error: `${name} can't run in ${environment}.`,
    missingResources,
  }
}

export type PanelServer = {
  port: number
  url: string
  close(): Promise<void>
}

export type PanelServerOptions = {
  localResourceDirectory?: string
}

export async function createPanelServer(port: number, options: PanelServerOptions = {}): Promise<PanelServer> {
  const instanceId = ++panelInstanceId
  let mcpUrl = readConfig().mcpUrl || MCP_URL
  let mcp: McpClient | null = null
  const running = new Map<number, Running>()

  const app = express()
  app.use(express.json({ limit: '2mb' }))

  const localResourceStatus = () => {
    let entries
    try {
      entries = loadLocalResourceEntries({ directory: options.localResourceDirectory })
    } catch (error) {
      return {
        definitions: {},
        localResourceError: String((error as Error)?.message ?? error),
        localResources: [],
      }
    }

    const localResources = Object.values(entries).map((entry) => {
      const spec = readLocalResourceSpec(entry.resourceId, { directory: options.localResourceDirectory })
      return {
        resourceId: entry.resourceId,
        binding: entry.binding,
        specFile: spec.specFile,
        specHash: spec.specHash,
      }
    })
    try {
      const definitions = loadLocalResourceDefinitions({ directory: options.localResourceDirectory })
      return { definitions, localResourceError: '', localResources }
    } catch (error) {
      return {
        definitions: {},
        localResourceError: String((error as Error)?.message ?? error),
        localResources,
      }
    }
  }

  app.get('/api/status', (_req, res) => {
    const { localResources, localResourceError } = localResourceStatus()
    res.json({
      mcpUrl,
      cachedAuth: hasCachedAuth(mcpUrl),
      connected: !!mcp,
      repoDir: readConfig().repoDir || '',
      localResources,
      localResourceError,
    })
  })

  const localSpecError = (res: express.Response, error: unknown) => {
    const message = String((error as Error)?.message ?? error)
    res.status(/is not configured$/.test(message) ? 404 : 400).json({ error: message })
  }

  app.get('/api/local-resources/:resourceId/spec', (req, res) => {
    try {
      res.json(readLocalResourceSpec(String(req.params.resourceId), {
        directory: options.localResourceDirectory,
      }))
    } catch (error) {
      localSpecError(res, error)
    }
  })

  app.put('/api/local-resources/:resourceId/spec', (req, res) => {
    try {
      res.json(saveLocalResourceSpec(String(req.params.resourceId), req.body?.content, {
        directory: options.localResourceDirectory,
      }))
    } catch (error) {
      localSpecError(res, error)
    }
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
    writeConfig({ mcpUrl })
    res.json({ mcpUrl, cachedAuth: hasCachedAuth(mcpUrl) })
  })

  // Connect + OAuth. Opens a browser on first auth; uses cached tokens otherwise.
  app.post('/api/auth', async (_req, res) => {
    if (!mcpUrl) return res.status(400).json({ error: 'Set the MCP URL first, then Save URL.' })
    try {
      if (!mcp) mcp = await connectMcp(mcpUrl)
      res.json({ connected: true, mcpUrl })
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) })
    }
  })

  app.get('/api/resources', async (_req, res) => {
    if (!mcpUrl) return res.status(400).json({ error: 'Set the MCP URL first, then Save URL.' })
    try {
      if (!mcp) mcp = await connectMcp(mcpUrl)
      const list = await mcp.listResources()
      const local = localResourceStatus()
      if (local.localResourceError) throw new Error(local.localResourceError)
      const resources = list
        .map((r) => {
          const definition = local.definitions[r.name]
          return {
            name: r.name,
            displayName: r.displayName ?? r.name,
            type: r.type ?? 'unknown',
            readable: Boolean(definition) || READABLE_TYPES.has(r.type ?? ''),
            localConfigured: Boolean(definition),
            note: definition
              ? `${basename(definition.specPath)} · #${definition.specHash.slice(0, 12)}`
              : r.type === 'restapi' ? 'only if OpenAPI-annotated or configured locally' : '',
          }
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
      res.json({ resources })
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) })
    }
  })

  // Directory browser: list subdirectories of `dir` (defaults to home).
  app.get('/api/browse', (req, res) => {
    const raw = String(req.query.dir || '').trim()
    const dir = !raw ? homedir() : raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw
    if (!existsSync(dir)) return res.status(400).json({ error: `not found: ${dir}` })
    try {
      const dirs = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b))
      const parent = dirname(dir)
      res.json({ dir, parent: parent === dir ? null : parent, dirs, isRepo: existsSync(join(dir, 'apps-v2')) })
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) })
    }
  })

  app.post('/api/scan', (req, res) => {
    const raw = String(req.body?.repoDir || '').trim()
    if (!raw) return res.status(400).json({ error: 'repoDir required' })
    // Be forgiving: expand ~, and try the path as-is or with a leading slash
    // (users often paste "Users/…" without the leading "/").
    const candidates = [
      raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw,
      isAbsolute(raw) ? raw : '/' + raw.replace(/^\/+/, ''),
    ]
    const repoDir = candidates.find((p) => existsSync(p))
    if (!repoDir) {
      return res.status(400).json({ error: `directory not found: ${raw} (use an absolute path, e.g. /Users/you/Projects/retool-ops)` })
    }
    try {
      const apps = scanApps(repoDir)
      writeConfig({ repoDir }) // remember the last good repo dir
      res.json({ apps, repoDir })
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) })
    }
  })

  // True only if nothing else on this machine is listening on the port.
  const portFree = (p: number) =>
    new Promise<boolean>((resolve) => {
      const s = createNetServer()
      s.once('error', () => resolve(false))
      s.once('listening', () => s.close(() => resolve(true)))
      s.listen(p, '0.0.0.0')
    })

  const nextPort = async () => {
    let p = 5174
    while (running.has(p) || !(await portFree(p))) p++ // skip ours AND any OS-level orphan
    return p
  }

  app.post('/api/run', async (req, res) => {
    let environment: RetoolEnvironment
    try {
      environment = parseRetoolEnvironment(req.body?.environment)
    } catch (error) {
      return res.status(400).json({ error: String((error as Error).message ?? error) })
    }
    const appPath = String(req.body?.appPath || '').trim()
    const worktreePath = String(req.body?.worktreePath || '').trim()
    const branch = String(req.body?.branch || '').trim()
    const name = String(req.body?.name || appPath.split('/').pop() || 'app')
    const writes = !!req.body?.writes
    if (!appPath) return res.status(400).json({ error: 'appPath required' })
    if (!worktreePath) return res.status(400).json({ error: 'worktreePath required' })
    if (!mcpUrl) return res.status(400).json({ error: 'Set the MCP URL first (section 1), then Save URL.' })
    // Attach to the exact worktree selected by the user/agent. Never switch or
    // create branches from the panel: stale selections fail closed.
    let worktree
    try {
      worktree = validateWorktreeTarget(appPath, worktreePath, branch)
    } catch (e: any) {
      return res.status(400).json({ error: String(e?.message ?? e) })
    }
    // Already running this exact app directory? Reuse its watcher and port.
    const existing = [...running.values()].find((r) => r.appPath === appPath)
    if (existing) {
      if (existing.environment !== environment || existing.writes !== writes) {
        return res.status(409).json({
          error: `${name} is already running in ${existing.environment} ` +
            `(${existing.writes ? 'writes enabled' : 'read-only'}). Stop it before changing environment or write mode.`,
        })
      }
      return res.json({ port: existing.port, url: existing.url, name: existing.name, branch: existing.branch, worktreePath: existing.worktreePath, head: existing.head, dirty: existing.dirty, environment: existing.environment, writes: existing.writes, alreadyRunning: true })
    }
    const p = await nextPort()
    // Launch in watch mode (dev.ts) so backend/query edits auto-reload the app.
    const args = buildRunnerArgs({ appPath, port: p, mcpUrl, environment, writes })
    const child = spawn(tsxBin, args, { cwd: TOOL_ROOT, env: process.env })
    const url = `http://localhost:${p}`
    let settled = false
    let stderr = ''
    const done = (body: any, code = 200) => {
      if (settled) return
      settled = true
      res.status(code).json(body)
    }
    child.stdout.on('data', (b) => {
      const s = b.toString()
      process.stdout.write(`[app:${p}] ${s}`)
      if (s.includes('serving')) {
        running.set(p, { appPath, worktreePath, branch, head: worktree.head, dirty: worktree.dirty, name, port: p, url, environment, writes, child })
        done({ port: p, url, name, branch, worktreePath, head: worktree.head, dirty: worktree.dirty, environment, writes })
      }
    })
    child.stderr.on('data', (b) => {
      const text = b.toString()
      stderr = (stderr + text).slice(-8000)
      process.stderr.write(`[app:${p}] ${text}`)
    })
    child.on('exit', (code) => {
      running.delete(p)
      done(runnerExitResponse(name, environment, code, stderr, readResourceRefs(appPath), mcpUrl), 400)
    })
    setTimeout(() => done({ port: p, url, name, branch, worktreePath, environment, writes, warning: 'started; not confirmed serving yet' }), 45000)
  })

  app.get('/api/running', (_req, res) => {
    res.json({
      apps: [...running.values()].map(({ name, appPath, worktreePath, branch, head, dirty, port, url, environment, writes }) => ({ name, appPath, worktreePath, branch, head, dirty, port, url, environment, writes })),
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

  app.get('/favicon.ico', (_req, res) => res.status(204).end())

  const vite = await createViteServer({
    root: join(HERE, 'ui'),
    cacheDir: panelViteCacheDir(port, instanceId),
    appType: 'spa',
    plugins: [react(), tailwindcss()],
    // Middleware-mode Vite defaults every panel to websocket port 24678.
    // Give each real panel port its own HMR socket so parallel panels and app
    // previews cannot prevent main.tsx from mounting.
    server: { middlewareMode: true, hmr: { port: port > 0 ? port + 20_000 : 24_679 } },
  })
  app.use(vite.middlewares)

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const listener = app.listen(port, () => resolve(listener))
    listener.once('error', reject)
  })
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const close = async () => {
    for (const r of running.values()) r.child.kill('SIGTERM')
    running.clear()
    if (mcp) await mcp.close().catch(() => {})
    await vite.close()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  return { port: actualPort, url: `http://localhost:${actualPort}`, close }
}

export async function startPanel(port: number): Promise<void> {
  const panel = await createPanelServer(port)
  console.log(`[panel] control panel: ${panel.url}`)
  process.once('SIGINT', async () => {
    await panel.close()
    process.exit(0)
  })
}
