import { spawn, type ChildProcess } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, dirname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import express from 'express'
import { createServer as createViteServer } from 'vite'
import { TOOL_ROOT, MCP_URL } from '../paths.js'
import { connectRetoolCli } from '../cliClient.js'
import { connectMcp, hasCachedAuth, type RetoolGroup } from '../mcpClient.js'
import { findAppDirs, scanApps, validateDirectoryTarget } from '../scan.js'
import { readConfig, writeConfig, type Config } from '../config.js'
import { repoRoot, validateWorktreeTarget } from '../git.js'
import { loadLocalResourceDefinitions, loadLocalResourceEntries } from '../localResourceConfig.js'
import { readLocalResourceSpec, saveLocalResourceSpec } from '../localResourceSpecStore.js'
import { parseRetoolEnvironment, type RetoolEnvironment } from '../environment.js'
import { readResourceRefs } from '../endpointRunner.js'
import type { ResourceRef } from '../resourceGlobals.js'
import { parseCurrentUser, resolveCurrentUser } from '../currentUser.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const tsxBin = join(TOOL_ROOT, 'node_modules', '.bin', 'tsx')
let panelInstanceId = 0

export type RetoolCliResult = { stdout: string; stderr: string }
export type RetoolCliRunner = (args: string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<RetoolCliResult>
export type CheckoutInstaller = (checkoutDir: string) => Promise<void>

export const runRetoolCli: RetoolCliRunner = (args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn('retool', args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const append = (current: string, chunk: Buffer) => (current + chunk.toString()).slice(-2_000_000)
  child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
  child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
  const timeoutMs = options.timeoutMs ?? 300_000
  const timeout = setTimeout(() => {
    child.kill('SIGTERM')
    reject(new Error(`Retool CLI timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  child.once('error', (error) => {
    clearTimeout(timeout)
    reject(error)
  })
  child.once('exit', (code) => {
    clearTimeout(timeout)
    if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
    else reject(new Error((stderr || stdout || `Retool CLI exited with code ${code}`).trim()))
  })
})

export const installCheckoutDependencies: CheckoutInstaller = (checkoutDir) => new Promise((resolve, reject) => {
  const child = spawn('pnpm', ['install'], {
    cwd: checkoutDir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const append = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-20_000) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.once('error', reject)
  child.once('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(output.trim() || `pnpm install exited with code ${code}`))
  })
})

function cliJson(result: RetoolCliResult): unknown {
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(`Retool CLI returned invalid JSON${result.stdout ? `: ${result.stdout}` : ''}`)
  }
}

function checkoutDirectory(value: unknown): string {
  const checkoutDir = String(value ?? '').trim()
  if (!checkoutDir || !isAbsolute(checkoutDir)) throw new Error('an absolute checkout directory is required')
  if (!existsSync(join(checkoutDir, '.retool', 'app.json'))) {
    throw new Error(`not a Retool CLI checkout: ${checkoutDir}`)
  }
  return checkoutDir
}

function appUuid(appDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
    const uuid = pkg?.retool?.app?.uuid
    return typeof uuid === 'string' && uuid.trim() ? uuid.trim() : null
  } catch {
    return null
  }
}

function isCliCheckout(appDir: string): boolean {
  return existsSync(join(appDir, '.retool', 'app.json'))
}

function checkoutHost(checkoutDir: string): string | null {
  try {
    const host = JSON.parse(readFileSync(join(checkoutDir, '.retool', 'app.json'), 'utf8'))?.host
    return typeof host === 'string' && host.trim() ? new URL(host).origin : null
  } catch {
    return null
  }
}

function checkoutResourceNames(checkoutDir: string): Set<string> | null {
  try {
    const resources = JSON.parse(readFileSync(join(checkoutDir, '.retool', 'resource-cache.json'), 'utf8'))?.resources
    if (!Array.isArray(resources)) return null
    return new Set(resources.flatMap((resource: { name?: unknown }) => (
      typeof resource?.name === 'string' ? [resource.name] : []
    )))
  } catch {
    return null
  }
}

function configuredHost(config: Config): string | null {
  if (config.mcpUrl) {
    try {
      return new URL(config.mcpUrl).origin
    } catch {
      /* use the configured checkout host below */
    }
  }
  return config.exploreCheckoutDir ? checkoutHost(config.exploreCheckoutDir) : null
}

function resourceBridgeScore(appPath: string, checkoutDir: string, config: Config): number | null {
  if (!isCliCheckout(checkoutDir)) return null
  const expectedHost = configuredHost(config)
  const candidateHost = checkoutHost(checkoutDir)
  if (expectedHost && candidateHost && expectedHost !== candidateHost) return null
  const available = checkoutResourceNames(checkoutDir)
  if (!available) return null
  let required: string[]
  try {
    required = readResourceRefs(appPath).map((resource) => resource.name)
  } catch {
    return null
  }
  return required.every((resourceName) => available.has(resourceName)) ? available.size : null
}

/**
 * Keep app source and resource execution isolated. Prefer an exact app checkout,
 * then reuse a same-org CLI checkout whose generated cache covers every resource
 * declared by the Git app. The bridge never becomes the app's editable source.
 */
export function resolveExploreCheckoutForApp(appPath: string, config: Config): string | undefined {
  if (isCliCheckout(appPath)) return appPath

  const uuid = appUuid(appPath)
  if (!uuid) return undefined

  const configuredCheckout = config.exploreCheckoutDir
  if (configuredCheckout && isCliCheckout(configuredCheckout) && appUuid(configuredCheckout) === uuid) {
    return configuredCheckout
  }

  const cliRoot = config.cliAppsDir
  if (!cliRoot || !existsSync(cliRoot)) {
    return configuredCheckout && resourceBridgeScore(appPath, configuredCheckout, config) !== null
      ? configuredCheckout
      : undefined
  }

  const canonicalCheckout = join(cliRoot, uuid)
  if (isCliCheckout(canonicalCheckout) && appUuid(canonicalCheckout) === uuid) return canonicalCheckout

  const candidates = findAppDirs(cliRoot).filter((candidate) => isCliCheckout(candidate))
  const exact = candidates.find((candidate) => appUuid(candidate) === uuid)
  if (exact) return exact

  return [...new Set([configuredCheckout, ...candidates].filter((candidate): candidate is string => Boolean(candidate)))]
    .flatMap((candidate) => {
      const score = resourceBridgeScore(appPath, candidate, config)
      return score === null ? [] : [{ candidate, score }]
    })
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))[0]?.candidate
}

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
  branch: string | null
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
  environment: RetoolEnvironment
  writes: boolean
  exploreCheckoutDir?: string
}): string[] {
  const args = [
    'src/dev.ts',
    '--app', input.appPath,
    '--port', String(input.port),
    '--environment', input.environment,
  ]
  if (input.exploreCheckoutDir) args.push('--checkout', input.exploreCheckoutDir)
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
  configFile?: string
  /** Test seam for the Retool group directory. */
  loadGroups?: (mcpUrl: string) => Promise<RetoolGroup[]>
  /** Test seam for the allowed auth/list/clone/pull/push-preview Retool CLI commands. */
  runCli?: RetoolCliRunner
  /** Test seam for installing a newly cloned checkout's locked dependencies. */
  installDependencies?: CheckoutInstaller
  /** Test seam for establishing and caching the MCP authorization. */
  authorizeMcp?: (mcpUrl: string) => Promise<void>
}

export async function createPanelServer(port: number, options: PanelServerOptions = {}): Promise<PanelServer> {
  const instanceId = ++panelInstanceId
  const readPanelConfig = () => readConfig(options.configFile)
  const writePanelConfig = (patch: Parameters<typeof writeConfig>[0]) => writeConfig(patch, options.configFile)
  const getMcpUrl = () => readPanelConfig().mcpUrl || MCP_URL
  const runCli = options.runCli ?? runRetoolCli
  const installDependencies = options.installDependencies ?? installCheckoutDependencies
  const loadGroups = options.loadGroups ?? (async (url: string) => {
    const client = await connectMcp(url)
    try {
      return await client.listGroups()
    } finally {
      await client.close()
    }
  })
  const authorizeMcp = options.authorizeMcp ?? (async (url: string) => {
    const client = await connectMcp(url)
    await client.close()
  })
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
    const panelConfig = readPanelConfig()
    const mcpUrl = getMcpUrl()
    res.json({
      mcpUrl,
      mcpConfigured: Boolean(panelConfig.mcpUrl),
      cachedAuth: hasCachedAuth(mcpUrl),
      connected: false,
      runtimeTransport: hasCachedAuth(mcpUrl) ? 'auto' : 'retool-cli',
      repoDir: panelConfig.repoDir || panelConfig.exploreCheckoutDir || '',
      cliAppsDir: panelConfig.cliAppsDir || (panelConfig.sourceMode !== 'git' ? panelConfig.repoDir : '') || '',
      gitRepoDir: panelConfig.gitRepoDir || (panelConfig.sourceMode === 'git' ? panelConfig.repoDir : '') || '',
      sourceMode: panelConfig.sourceMode || 'cli',
      exploreCheckoutDir: panelConfig.exploreCheckoutDir || '',
      localResources,
      localResourceError,
      currentUser: resolveCurrentUser(panelConfig.currentUser),
    })
  })

  app.put('/api/current-user', (req, res) => {
    try {
      const currentUser = parseCurrentUser(req.body?.currentUser)
      writePanelConfig({ currentUser })
      res.json({ currentUser })
    } catch (error) {
      res.status(400).json({ error: String((error as Error)?.message ?? error) })
    }
  })

  app.post('/api/current-user/from-cli', async (_req, res) => {
    try {
      const config = readPanelConfig()
      if (config.mcpUrl) throw new Error('CLI identity fallback is only used when MCP is not configured')
      const who = cliJson(await runCli(['whoami', '--json'], { timeoutMs: 30_000 })) as Record<string, unknown>
      const email = String(who.email ?? '').trim()
      const fullName = String(who.name ?? '').trim()
      if (!email || !fullName) throw new Error('Retool CLI did not return a name and email')
      const parts = fullName.split(/\s+/)
      const current = resolveCurrentUser(config.currentUser)
      const currentUser = {
        ...current,
        email,
        fullName,
        firstName: parts[0] ?? '',
        lastName: parts.slice(1).join(' '),
        sid: current.sid === 'local-dev' ? `cli-${email}` : current.sid,
      }
      writePanelConfig({ currentUser })
      res.json({ currentUser })
    } catch (error) {
      res.status(400).json({ error: `Could not load the current user from Retool CLI: ${String((error as Error)?.message ?? error)}` })
    }
  })

  app.get('/api/groups', async (_req, res) => {
    try {
      res.json({ groups: await loadGroups(getMcpUrl()) })
    } catch (error) {
      res.status(400).json({
        error: `Could not load the Retool group directory: ${String((error as Error)?.message ?? error)}`,
      })
    }
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

  // MCP supplies the group directory and the persistent fast path for calls
  // the runtime has positively classified as read-only. App source and preview
  // pushes remain CLI-backed; writes and ambiguous calls execute through CLI.
  app.post('/api/mcp-url', (req, res) => {
    try {
      const mcpUrl = String(req.body?.mcpUrl ?? '').trim()
      const parsed = new URL(mcpUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('MCP URL must use HTTP or HTTPS')
      writePanelConfig({ mcpUrl: parsed.toString() })
      res.json({ mcpUrl: parsed.toString(), cachedAuth: hasCachedAuth(parsed.toString()) })
    } catch (error) {
      res.status(400).json({ error: `Invalid MCP endpoint: ${String((error as Error)?.message ?? error)}` })
    }
  })

  app.post('/api/auth', async (_req, res) => {
    const mcpUrl = getMcpUrl()
    try {
      await authorizeMcp(mcpUrl)
      res.json({ connected: true, mcpUrl })
    } catch (error) {
      res.status(400).json({ error: `Could not authorize MCP: ${String((error as Error)?.message ?? error)}` })
    }
  })

  const cliError = (res: express.Response, error: unknown) => {
    res.status(400).json({ error: String((error as Error)?.message ?? error) })
  }

  app.get('/api/cli/status', async (_req, res) => {
    try {
      const [version, status] = await Promise.all([
        runCli(['--version'], { timeoutMs: 10_000 }),
        runCli(['auth', 'status', '--json'], { timeoutMs: 30_000 }),
      ])
      res.json({ version: version.stdout, status: cliJson(status) })
    } catch (error) {
      cliError(res, error)
    }
  })

  app.post('/api/cli/login', async (req, res) => {
    try {
      const host = String(req.body?.host ?? '').trim()
      const args = ['auth', 'login']
      if (host) args.push('--host', host)
      await runCli(args)
      const [version, status] = await Promise.all([
        runCli(['--version'], { timeoutMs: 10_000 }),
        runCli(['auth', 'status', '--json'], { timeoutMs: 30_000 }),
      ])
      res.json({ version: version.stdout, status: cliJson(status) })
    } catch (error) {
      cliError(res, error)
    }
  })

  app.get('/api/cli/apps', async (req, res) => {
    try {
      const host = String(req.query.host ?? '').trim()
      const args = ['apps', '--json']
      if (host) args.push('--host', host)
      res.json({ apps: cliJson(await runCli(args, { timeoutMs: 60_000 })) })
    } catch (error) {
      cliError(res, error)
    }
  })

  app.post('/api/cli/clone', async (req, res) => {
    try {
      const appId = String(req.body?.appId ?? '').trim()
      const parentDir = String(req.body?.parentDir ?? '').trim()
      const branch = String(req.body?.branch ?? '').trim()
      const host = String(req.body?.host ?? '').trim()
      if (!appId) throw new Error('appId required')
      if (!/^[a-zA-Z0-9-]+$/.test(appId)) throw new Error('appId must be a Retool app UUID')
      if (!parentDir || !isAbsolute(parentDir)) throw new Error('an absolute apps parent directory is required')
      if (!existsSync(parentDir)) throw new Error(`apps parent directory not found: ${parentDir}`)
      const targetDir = join(parentDir, appId)
      if (existsSync(targetDir) && readdirSync(targetDir).length > 0) throw new Error(`target directory is not empty: ${targetDir}`)
      const args = ['clone', appId]
      if (branch) args.push('--branch', branch)
      if (host) args.push('--host', host)
      await runCli(args, { cwd: parentDir })
      if (!existsSync(join(targetDir, '.retool', 'app.json'))) {
        throw new Error(`Retool CLI completed but did not create the expected checkout: ${targetDir}`)
      }
      await installDependencies(targetDir)
      writePanelConfig({ repoDir: parentDir, cliAppsDir: parentDir, sourceMode: 'cli', exploreCheckoutDir: targetDir })
      res.json({
        result: { status: 'cloned', message: 'App cloned and dependencies installed.', checkoutDir: targetDir },
        checkoutDir: targetDir,
        appsRootDir: parentDir,
      })
    } catch (error) {
      cliError(res, error)
    }
  })

  app.post('/api/cli/pull', async (req, res) => {
    try {
      const cwd = checkoutDirectory(req.body?.checkoutDir)
      res.json({ result: cliJson(await runCli(['pull', '--json'], { cwd })) })
    } catch (error) {
      cliError(res, error)
    }
  })

  app.post('/api/cli/push', async (req, res) => {
    try {
      if (req.body?.confirmed !== true) throw new Error('explicit push confirmation required')
      const cwd = checkoutDirectory(req.body?.checkoutDir)
      const message = String(req.body?.message ?? '').trim()
      if (!message) throw new Error('push message required')
      if (message.length > 500) throw new Error('push message must be 500 characters or fewer')
      res.json({
        result: cliJson(await runCli(['push', '--wait', '--message', message, '--json'], { cwd })),
      })
    } catch (error) {
      cliError(res, error)
    }
  })

  app.all('/api/cli/publish', (_req, res) => {
    res.status(405).json({ error: 'This runner does not publish. Use your development agent or Retool CLI directly.' })
  })


  app.get('/api/resources', async (_req, res) => {
    try {
      const checkoutDir = readPanelConfig().exploreCheckoutDir || ''
      const cli = await connectRetoolCli(checkoutDir)
      const list = await cli.listResources()
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
    const raw = String(req.body?.repoDir || readPanelConfig().exploreCheckoutDir || '').trim()
    const sourceMode = req.body?.sourceMode === 'git' ? 'git' : 'cli'
    if (!raw) return res.status(400).json({ error: 'local apps parent folder required' })
    // Be forgiving: expand ~, and try the path as-is or with a leading slash
    // (users often paste "Users/…" without the leading "/").
    const candidates = [
      raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw,
      isAbsolute(raw) ? raw : '/' + raw.replace(/^\/+/, ''),
    ]
    const repoDir = candidates.find((p) => existsSync(p))
    if (!repoDir) {
      return res.status(400).json({ error: `directory not found: ${raw} (use an absolute local apps parent folder)` })
    }
    try {
      const scannedApps = scanApps(repoDir)
      const isCliCheckout = existsSync(join(repoDir, '.retool', 'app.json'))
      const panelConfig = writePanelConfig({
        repoDir, // backward-compatible name for the last app source directory
        sourceMode,
        ...(sourceMode === 'git' ? { gitRepoDir: repoDir } : { cliAppsDir: repoDir }),
        ...(isCliCheckout ? { exploreCheckoutDir: repoDir } : {}),
      })
      const apps = scannedApps.map((app) => ({
        ...app,
        cliCheckoutAvailable: Boolean(resolveExploreCheckoutForApp(app.path, panelConfig)),
      }))
      res.json({ apps, repoDir, sourceMode })
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
    if (!worktreePath) return res.status(400).json({ error: 'app source directory required' })
    const exploreCheckoutDir = resolveExploreCheckoutForApp(appPath, readPanelConfig())
    if (!exploreCheckoutDir) {
      const uuid = appUuid(appPath)
      return res.status(400).json({
        error: uuid
          ? `No matching Retool CLI checkout for app ${uuid}. Open Settings → CLI checkouts and clone this app first.`
          : 'This app has no Retool app UUID, so its matching CLI checkout cannot be resolved.',
      })
    }
    // Git checkouts retain exact worktree validation. Plain Retool CLI
    // checkouts are validated by canonical directory containment instead.
    let source = { branch: null as string | null, head: '', dirty: false }
    try {
      if (repoRoot(appPath)) {
        const worktree = validateWorktreeTarget(appPath, worktreePath, branch)
        source = { branch: worktree.branch, head: worktree.head, dirty: worktree.dirty }
      } else {
        validateDirectoryTarget(appPath, worktreePath)
      }
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
    const args = buildRunnerArgs({
      appPath,
      port: p,
      environment,
      writes,
      exploreCheckoutDir,
    })
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
        running.set(p, { appPath, worktreePath, branch: source.branch, head: source.head, dirty: source.dirty, name, port: p, url, environment, writes, child })
        done({ port: p, url, name, branch: source.branch, worktreePath, head: source.head, dirty: source.dirty, environment, writes })
      }
    })
    child.stderr.on('data', (b) => {
      const text = b.toString()
      stderr = (stderr + text).slice(-8000)
      process.stderr.write(`[app:${p}] ${text}`)
    })
    child.on('exit', (code) => {
      running.delete(p)
      done(runnerExitResponse(name, environment, code, stderr, readResourceRefs(appPath), getMcpUrl()), 400)
    })
    setTimeout(() => done({ port: p, url, name, branch: source.branch, worktreePath, environment, writes, warning: 'started; not confirmed serving yet' }), 45000)
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
