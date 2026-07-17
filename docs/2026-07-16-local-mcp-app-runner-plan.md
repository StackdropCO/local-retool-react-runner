# Local MCP App Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Retool "apps-as-code" `Shift Utilization Dashboard` locally end-to-end, using the Retool MCP (`retool_execute_resource_ts`) as the resource/backend connection.

**Architecture:** A single Node process serves the app via Vite (root = this tool dir; the app's `App.tsx` is imported by absolute path; the missing `./hooks/backend/shift` module is served as an in-memory Vite virtual module). Frontend hooks POST to `/rpc/:endpoint`, which runs the app's `backend/shift/*.ts` functions with injected resource globals whose `.query()`/op calls forward into `retool_execute_resource_ts` over a standalone-OAuth MCP client. Every MCP call is appended to a JSONL query log. Writes are blocked unless `--writes` is passed.

**Tech Stack:** Node 20+, TypeScript, `tsx` (runtime TS loader), Vite 6, Vitest, `@modelcontextprotocol/sdk`, `open` (browser launch), `express`.

## Global Constraints

- **Never touch the `retool-ops` git repo.** Read app source in place; write nothing into it. All tool files, caches, logs live under `~/Projects/local-mcp-runner`. Commits go to a *separate* git repo initialised inside the tool dir.
- **Tool root:** `/Users/arsany.milad.ext/Projects/local-mcp-runner` (absolute paths throughout).
- **Target app dir (default):** `/Users/arsany.milad.ext/Projects/retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard` (contains `frontend/` and `backend/`).
- **MCP endpoint:** `https://ops.wayve.retool.com/mcp` (`type: http`, StreamableHTTP, OAuth — no static key).
- **Read-only by default.** `--writes` opts into `INSERT/UPDATE/DELETE/...`.
- **Resource globals & shapes (from app source):** `databricks.query<T>(sql) → {data:T[]}`, `lakebaseRetoolOltp.query<T>(sql) → {data:T[]}`, `connectteamapi.<ns>.<op>(...args)` (OpenAPI REST). Endpoint fn signature: `default async (req: { params; user }) => value`.
- **Generated hook shape (from `App.tsx`):** `useX() → { trigger(params, opts?) → { result: Promise<value> } }`. Only `.trigger(p,o).result` is consumed.
- **ESM project** (`"type": "module"`). All TS is ESM.

---

### Task 1: Project scaffold, deps, test harness, separate git repo

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/paths.ts`
- Test: `src/paths.test.ts`

**Interfaces:**
- Produces: `TOOL_ROOT: string`, `DEFAULT_APP_DIR: string`, `MCP_URL: string`, `authDir(): string`, `logsDir(): string` from `src/paths.ts`.

- [ ] **Step 1: Initialise the tool's own git repo (NOT retool-ops)**

```bash
cd /Users/arsany.milad.ext/Projects/local-mcp-runner
git init
git rev-parse --show-toplevel   # must print .../local-mcp-runner, NOT .../retool-ops
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "local-mcp-runner",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "probe": "tsx src/scripts/probe.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "express": "^4.21.0",
    "open": "^10.1.0",
    "tsx": "^4.19.0",
    "vite": "^6.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } })
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
.mcp-auth/
logs/
```

- [ ] **Step 6: Install deps**

Run: `cd /Users/arsany.milad.ext/Projects/local-mcp-runner && npm install`
Expected: exits 0, `node_modules/` populated.

- [ ] **Step 7: Write the failing test for `src/paths.ts`**

```ts
// src/paths.test.ts
import { describe, it, expect } from 'vitest'
import { TOOL_ROOT, DEFAULT_APP_DIR, MCP_URL, authDir, logsDir } from './paths.js'

describe('paths', () => {
  it('points at the tool root and target app, not the retool-ops repo root', () => {
    expect(TOOL_ROOT).toBe('/Users/arsany.milad.ext/Projects/local-mcp-runner')
    expect(DEFAULT_APP_DIR).toContain('Shift Utilization Dashboard')
    expect(MCP_URL).toBe('https://ops.wayve.retool.com/mcp')
    expect(authDir()).toBe(TOOL_ROOT + '/.mcp-auth')
    expect(logsDir()).toBe(TOOL_ROOT + '/logs')
  })
})
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm test -- src/paths.test.ts`
Expected: FAIL — cannot resolve `./paths.js`.

- [ ] **Step 9: Implement `src/paths.ts`**

```ts
export const TOOL_ROOT = '/Users/arsany.milad.ext/Projects/local-mcp-runner'
export const DEFAULT_APP_DIR =
  '/Users/arsany.milad.ext/Projects/retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard'
export const MCP_URL = 'https://ops.wayve.retool.com/mcp'
export const authDir = () => `${TOOL_ROOT}/.mcp-auth`
export const logsDir = () => `${TOOL_ROOT}/logs`
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm test -- src/paths.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "chore: scaffold local-mcp-runner project"
```

---

### Task 2: Query log (JSONL history of every MCP call)

**Files:**
- Create: `src/queryLog.ts`
- Test: `src/queryLog.test.ts`

**Interfaces:**
- Consumes: `logsDir()` from `src/paths.ts`.
- Produces: `type QueryRecord = { ts: string; endpoint: string; resourceNames: string[]; code: string; ok: boolean; error?: string; rowCount?: number; durationMs: number }` and `logQuery(rec: QueryRecord, dir?: string): void` (synchronous append). Filename: `queries-<YYYY-MM-DD>.jsonl` derived from `rec.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/queryLog.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logQuery } from './queryLog.js'

describe('logQuery', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qlog-')) })

  it('appends one JSONL line per call into a date-named file', () => {
    logQuery({ ts: '2026-07-16T10:00:00.000Z', endpoint: 'getShiftTimeline', resourceNames: ['Databricks'], code: 'return await databricks.query("SELECT 1")', ok: true, rowCount: 1, durationMs: 42 }, dir)
    logQuery({ ts: '2026-07-16T10:00:01.000Z', endpoint: 'getShiftTimeline', resourceNames: ['Lakebase'], code: 'return await lakebaseRetoolOltp.query("SELECT 2")', ok: false, error: 'boom', durationMs: 5 }, dir)
    const files = readdirSync(dir)
    expect(files).toEqual(['queries-2026-07-16.jsonl'])
    const lines = readFileSync(join(dir, files[0]), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).ok).toBe(true)
    expect(JSON.parse(lines[1]).error).toBe('boom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/queryLog.test.ts`
Expected: FAIL — cannot resolve `./queryLog.js`.

- [ ] **Step 3: Implement `src/queryLog.ts`**

```ts
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logsDir } from './paths.js'

export type QueryRecord = {
  ts: string
  endpoint: string
  resourceNames: string[]
  code: string
  ok: boolean
  error?: string
  rowCount?: number
  durationMs: number
}

export function logQuery(rec: QueryRecord, dir: string = logsDir()): void {
  mkdirSync(dir, { recursive: true })
  const day = rec.ts.slice(0, 10)
  appendFileSync(join(dir, `queries-${day}.jsonl`), JSON.stringify(rec) + '\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/queryLog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: JSONL query-history log"
```

---

### Task 3: Snippet builders + write detection (pure functions)

**Files:**
- Create: `src/snippets.ts`
- Test: `src/snippets.test.ts`

**Interfaces:**
- Produces:
  - `isWrite(sql: string): boolean` — true for `INSERT/UPDATE/DELETE/MERGE/INSERT ... ON CONFLICT/CREATE/ALTER/DROP/TRUNCATE`, case-insensitive, ignoring leading whitespace/comments.
  - `buildSqlSnippet(binding: string, sql: string): string` — returns `return await <binding>.query(<json-encoded sql>)`.
  - `buildRestSnippet(binding: string, path: string[], args: unknown[]): string` — returns `return await <binding>.<path.join('.')>(<json args, comma-joined>)`.
- Consumed by: Task 5 (`resourceGlobals`).

- [ ] **Step 1: Write the failing test**

```ts
// src/snippets.test.ts
import { describe, it, expect } from 'vitest'
import { isWrite, buildSqlSnippet, buildRestSnippet } from './snippets.js'

describe('isWrite', () => {
  it('flags writes and clears reads, ignoring whitespace/comments/case', () => {
    expect(isWrite('  SELECT * FROM t')).toBe(false)
    expect(isWrite('with x as (select 1) select * from x')).toBe(false)
    expect(isWrite('insert into shift_ops.t values (1)')).toBe(true)
    expect(isWrite('  -- note\n UPDATE t SET a=1')).toBe(true)
    expect(isWrite('DELETE FROM t')).toBe(true)
    expect(isWrite('/* c */ merge into t ...')).toBe(true)
  })
})

describe('buildSqlSnippet', () => {
  it('json-encodes the sql so quotes/newlines survive', () => {
    const s = buildSqlSnippet('databricks', "SELECT 'a\nb'")
    expect(s).toBe('return await databricks.query(' + JSON.stringify("SELECT 'a\nb'") + ')')
  })
})

describe('buildRestSnippet', () => {
  it('joins the property path and json-encodes each arg', () => {
    const s = buildRestSnippet('connectteamapi', ['schedulev1', 'getShifts'], [123, { limit: 200 }])
    expect(s).toBe('return await connectteamapi.schedulev1.getShifts(123, {"limit":200})')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/snippets.test.ts`
Expected: FAIL — cannot resolve `./snippets.js`.

- [ ] **Step 3: Implement `src/snippets.ts`**

```ts
const WRITE_RE = /^(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|REPLACE|UPSERT|GRANT|REVOKE)\b/i

function stripLeading(sql: string): string {
  let s = sql
  for (;;) {
    const before = s
    s = s.replace(/^\s+/, '')
    s = s.replace(/^--[^\n]*\n?/, '')
    s = s.replace(/^\/\*[\s\S]*?\*\//, '')
    if (s === before) return s
  }
}

export function isWrite(sql: string): boolean {
  return WRITE_RE.test(stripLeading(sql))
}

export function buildSqlSnippet(binding: string, sql: string): string {
  return `return await ${binding}.query(${JSON.stringify(sql)})`
}

export function buildRestSnippet(binding: string, path: string[], args: unknown[]): string {
  const encoded = args.map((a) => JSON.stringify(a)).join(', ')
  return `return await ${binding}.${path.join('.')}(${encoded})`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/snippets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: SQL/REST snippet builders + write detection"
```

---

### Task 4: MCP client with standalone OAuth + live probe

**Files:**
- Create: `src/mcpClient.ts`, `src/oauthProvider.ts`, `src/scripts/probe.ts`

**Interfaces:**
- Produces `src/mcpClient.ts`:
  - `type McpClient = { executeResourceTs(resourceNames: string[], code: string, environmentName?: string): Promise<unknown>; getResourceTsDefinitions(resourceNames: string[]): Promise<string>; listResources(nameContains?: string): Promise<Array<{ name: string; displayName?: string; type?: string }>>; close(): Promise<void> }`
  - `connectMcp(): Promise<McpClient>` — connects, runs OAuth if needed, returns the client.
- Consumed by: Tasks 5, 8.
- **Note:** this task is verified by the live probe (network + OAuth cannot be meaningfully unit-tested). The probe is the test.

- [ ] **Step 1: Implement `src/oauthProvider.ts` (file-backed token store + loopback callback)**

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import open from 'open'
import { authDir } from './paths.js'
import type {
  OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

const CALLBACK_PORT = 8788
const dir = authDir()
const read = (f: string) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : undefined)
const write = (f: string, v: unknown) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, f), JSON.stringify(v, null, 2)) }

export class FileOAuthProvider implements OAuthClientProvider {
  get redirectUrl() { return `http://localhost:${CALLBACK_PORT}/auth/callback` }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'local-mcp-runner',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }
  clientInformation(): OAuthClientInformation | undefined { return read('client.json') }
  saveClientInformation(info: OAuthClientInformationFull) { write('client.json', info) }
  tokens(): OAuthTokens | undefined { return read('tokens.json') }
  saveTokens(tokens: OAuthTokens) { write('tokens.json', tokens) }
  saveCodeVerifier(v: string) { write('verifier.json', v) }
  codeVerifier(): string { return read('verifier.json') }
  async redirectToAuthorization(url: URL) { await open(url.toString()) }
}

// Wait for the OAuth redirect on the loopback port and return the `code`.
export function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '', `http://localhost:${CALLBACK_PORT}`)
      const code = u.searchParams.get('code')
      res.end(code ? 'Authorized. You can close this tab.' : 'No code received.')
      server.close()
      code ? resolve(code) : reject(new Error('no code in callback'))
    })
    server.listen(CALLBACK_PORT)
  })
}
```

- [ ] **Step 2: Implement `src/mcpClient.ts`**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { MCP_URL } from './paths.js'
import { FileOAuthProvider, waitForCallback } from './oauthProvider.js'

export type McpClient = {
  executeResourceTs(resourceNames: string[], code: string, environmentName?: string): Promise<unknown>
  getResourceTsDefinitions(resourceNames: string[]): Promise<string>
  listResources(nameContains?: string): Promise<Array<{ name: string; displayName?: string; type?: string }>>
  close(): Promise<void>
}

function textOf(result: any): string {
  const c = result?.content
  if (Array.isArray(c)) return c.map((p: any) => (p?.type === 'text' ? p.text : '')).join('')
  return typeof result === 'string' ? result : JSON.stringify(result)
}

export async function connectMcp(): Promise<McpClient> {
  const authProvider = new FileOAuthProvider()
  const client = new Client({ name: 'local-mcp-runner', version: '0.1.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider })

  try {
    await client.connect(transport)
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e
    const code = await waitForCallback() // browser was opened by the provider
    await transport.finishAuth(code)
    await client.connect(transport)
  }

  const call = async (name: string, args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name, arguments: args })
    const text = textOf(res)
    try { return JSON.parse(text) } catch { return text }
  }

  return {
    async executeResourceTs(resourceNames, code, environmentName) {
      return call('retool_execute_resource_ts', { resourceNames, code, ...(environmentName ? { environmentName } : {}) })
    },
    async getResourceTsDefinitions(resourceNames) {
      const r = await call('retool_get_resource_ts_definitions', { resourceNames })
      return typeof r === 'string' ? r : JSON.stringify(r)
    },
    async listResources(nameContains) {
      const r: any = await call('retool_list_resources', { limit: 100, ...(nameContains ? { name_contains: nameContains } : {}) })
      const arr = Array.isArray(r) ? r : r?.resources ?? r?.data ?? []
      return arr.map((x: any) => ({ name: x.name, displayName: x.displayName ?? x.display_name, type: x.type ?? x.resource_type }))
    },
    async close() { await client.close() },
  }
}
```

- [ ] **Step 3: Implement `src/scripts/probe.ts` (verification harness)**

```ts
import { connectMcp } from '../mcpClient.js'

async function main() {
  const mcp = await connectMcp()
  console.log('[probe] connected + authorized')

  const resources = await mcp.listResources()
  console.log('[probe] resources:', resources.map((r) => `${r.displayName ?? r.name} (${r.type})`).join(', '))

  const databricks = resources.find((r) => /databricks$/i.test(r.type ?? '') || /databricks/i.test(r.displayName ?? ''))
  if (databricks) {
    const defs = await mcp.getResourceTsDefinitions([databricks.name])
    console.log('[probe] databricks binding defs (first 400 chars):\n', defs.slice(0, 400))
    // Use the binding name printed above; adjust if different from `databricks`.
    const out = await mcp.executeResourceTs([databricks.name], 'return await databricks.query("SELECT 1 AS ok")')
    console.log('[probe] SELECT 1 result shape:', JSON.stringify(out).slice(0, 400))
  }
  await mcp.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Run the probe to verify OAuth + result shape**

Run: `cd /Users/arsany.milad.ext/Projects/local-mcp-runner && npm run probe`
Expected: a browser opens for Retool authorization; after approving, the console prints the resource list, the Databricks binding name, and the `SELECT 1` result shape.
**ACTION:** record the exact binding variable names and the result shape (`{data:[...]}` vs `{rows}` vs array). Tasks 5's normalization uses this. If the binding name differs from `databricks`, note it — the snippet must use the name from the defs.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: standalone-OAuth MCP client + live probe"
```

---

### Task 5: Resource globals (shims) with write-gating + logging

**Files:**
- Create: `src/resourceGlobals.ts`
- Test: `src/resourceGlobals.test.ts`

**Interfaces:**
- Consumes: `McpClient` (Task 4), `isWrite`/`buildSqlSnippet`/`buildRestSnippet` (Task 3), `logQuery` (Task 2).
- Produces:
  - `class WriteBlockedError extends Error`
  - `type ResourceMap = Record<string, { resourceName: string; binding: string; kind: 'sql' | 'rest' }>`
  - `resolveResources(mcp, refs): Promise<ResourceMap>` where `refs` is the app's `resourceReferencesByFile` flattened to unique `{ displayName, type }`. Maps each to `{ resourceName, binding, kind }` (kind: `rest` for `restapi`, else `sql`). Binding chosen from `getResourceTsDefinitions` (fallback: camelCase of displayName).
  - `buildGlobals(mcp, map, opts: { writes: boolean; endpoint: string; normalize: (raw: unknown) => unknown }): Record<string, unknown>` — returns an object keyed by binding name; each value is the shim global (`{ query }` for sql, a `Proxy` for rest).
- Consumed by: Task 6 (`endpointRunner`).

- [ ] **Step 1: Write the failing test (uses a fake McpClient — no network)**

```ts
// src/resourceGlobals.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildGlobals, WriteBlockedError, type ResourceMap } from './resourceGlobals.js'

const fakeMcp = (ret: unknown = { data: [{ ok: 1 }] }) => ({
  executeResourceTs: vi.fn().mockResolvedValue(ret),
  getResourceTsDefinitions: vi.fn(), listResources: vi.fn(), close: vi.fn(),
})
const map: ResourceMap = {
  Databricks: { resourceName: 'databricks_rn', binding: 'databricks', kind: 'sql' },
  'Lakebase Retool - OLTP': { resourceName: 'lakebase_rn', binding: 'lakebaseRetoolOltp', kind: 'sql' },
  ConnectTeamAPI: { resourceName: 'ct_rn', binding: 'connectteamapi', kind: 'rest' },
}

describe('buildGlobals', () => {
  it('sql read forwards a query snippet and normalizes the result', async () => {
    const mcp = fakeMcp({ data: [{ ok: 1 }] })
    const g: any = buildGlobals(mcp as any, map, { writes: true, endpoint: 'e', normalize: (r) => r })
    const out = await g.databricks.query('SELECT 1')
    expect(mcp.executeResourceTs).toHaveBeenCalledWith(['databricks_rn'], 'return await databricks.query("SELECT 1")', undefined)
    expect(out).toEqual({ data: [{ ok: 1 }] })
  })

  it('blocks a write when writes=false, before calling the MCP', async () => {
    const mcp = fakeMcp()
    const g: any = buildGlobals(mcp as any, map, { writes: false, endpoint: 'e', normalize: (r) => r })
    await expect(g.lakebaseRetoolOltp.query('INSERT INTO t VALUES (1)')).rejects.toBeInstanceOf(WriteBlockedError)
    expect(mcp.executeResourceTs).not.toHaveBeenCalled()
  })

  it('rest proxy forwards a namespaced op call', async () => {
    const mcp = fakeMcp({ data: { shifts: [] } })
    const g: any = buildGlobals(mcp as any, map, { writes: true, endpoint: 'e', normalize: (r) => r })
    await g.connectteamapi.schedulev1.getShifts(123, { limit: 200 })
    expect(mcp.executeResourceTs).toHaveBeenCalledWith(['ct_rn'], 'return await connectteamapi.schedulev1.getShifts(123, {"limit":200})', undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/resourceGlobals.test.ts`
Expected: FAIL — cannot resolve `./resourceGlobals.js`.

- [ ] **Step 3: Implement `src/resourceGlobals.ts`**

```ts
import type { McpClient } from './mcpClient.js'
import { isWrite, buildSqlSnippet, buildRestSnippet } from './snippets.js'
import { logQuery } from './queryLog.js'

export class WriteBlockedError extends Error {
  constructor(sql: string) { super(`Write blocked (read-only mode). Pass --writes to enable.\nSQL: ${sql.slice(0, 200)}`); this.name = 'WriteBlockedError' }
}

export type ResourceMap = Record<string, { resourceName: string; binding: string; kind: 'sql' | 'rest' }>

const camel = (s: string) => s.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^([A-Z])/, (m) => m.toLowerCase())

export async function resolveResources(
  mcp: McpClient,
  refs: Array<{ displayName: string; type: string }>,
): Promise<ResourceMap> {
  const map: ResourceMap = {}
  const all = await mcp.listResources()
  for (const ref of refs) {
    if (map[ref.displayName]) continue
    const match = all.find((r) => r.displayName === ref.displayName) ?? all.find((r) => r.name === ref.displayName)
    const resourceName = match?.name ?? ref.displayName
    let binding = camel(ref.displayName)
    try {
      const defs = await mcp.getResourceTsDefinitions([resourceName])
      const m = defs.match(/(?:const|declare const)\s+([A-Za-z_$][\w$]*)\s*[:=]/)
      if (m) binding = m[1]
    } catch { /* keep camelCase fallback */ }
    map[ref.displayName] = { resourceName, binding, kind: ref.type === 'restapi' ? 'rest' : 'sql' }
  }
  return map
}

export function buildGlobals(
  mcp: McpClient,
  map: ResourceMap,
  opts: { writes: boolean; endpoint: string; normalize: (raw: unknown) => unknown; environmentName?: string },
): Record<string, unknown> {
  const globals: Record<string, unknown> = {}
  const run = async (resourceName: string, code: string, resourceNames: string[]) => {
    const started = Date.now()
    const ts = new Date(started).toISOString()
    try {
      const raw = await mcp.executeResourceTs(resourceNames, code, opts.environmentName)
      const out = opts.normalize(raw)
      const rows = (out as any)?.data
      logQuery({ ts, endpoint: opts.endpoint, resourceNames, code, ok: true, rowCount: Array.isArray(rows) ? rows.length : undefined, durationMs: Date.now() - started })
      return out
    } catch (err) {
      logQuery({ ts, endpoint: opts.endpoint, resourceNames, code, ok: false, error: String((err as Error)?.message ?? err), durationMs: Date.now() - started })
      throw err
    }
  }

  for (const entry of Object.values(map)) {
    if (entry.kind === 'sql') {
      globals[entry.binding] = {
        query: async (sql: string) => {
          if (!opts.writes && isWrite(sql)) throw new WriteBlockedError(sql)
          return run(entry.resourceName, buildSqlSnippet(entry.binding, sql), [entry.resourceName])
        },
      }
    } else {
      const makeProxy = (path: string[]): any =>
        new Proxy(function () {} as any, {
          get: (_t, prop: string) => makeProxy([...path, prop]),
          apply: (_t, _this, args: unknown[]) => run(entry.resourceName, buildRestSnippet(entry.binding, path, args), [entry.resourceName]),
        })
      globals[entry.binding] = makeProxy([])
    }
  }
  return globals
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/resourceGlobals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: MCP-backed resource-global shims with write-gating + logging"
```

---

### Task 6: Endpoint runner (loads app backend TS, injects globals)

**Files:**
- Create: `src/endpointRunner.ts`, `src/fixtures/echoEndpoint.ts` (test fixture)
- Test: `src/endpointRunner.test.ts`

**Interfaces:**
- Consumes: `buildGlobals`/`resolveResources`/`ResourceMap` (Task 5), `McpClient` (Task 4).
- Produces:
  - `readResourceRefs(appDir: string): Array<{ displayName: string; type: string }>` — reads app `package.json` → flattens `resourceReferencesByFile` to unique `{displayName,type}`.
  - `type Runner = { run(endpoint: string, params: unknown): Promise<unknown> }`
  - `createRunner(opts: { appDir: string; globals: Record<string, unknown>; user?: unknown }): Runner` — assigns globals to `globalThis`, dynamically imports `<appDir>/backend/shift/<endpoint>.ts` (via `tsx` at runtime), calls `default({ params, user })`. Caches imported modules.
- Consumed by: Task 8 (server).
- **Note:** `default` endpoint fns are discovered by file name; `run('getShiftTimeline', p)` imports `backend/shift/getShiftTimeline.ts`.

- [ ] **Step 1: Create the test fixture `src/fixtures/echoEndpoint.ts`**

```ts
// Mimics an app backend endpoint: reads a global + returns params.
export default async function echoEndpoint(req: { params: any; user: any }) {
  const g = (globalThis as any).fakeResource
  const probe = g ? await g.query('SELECT 1') : null
  return { params: req.params, user: req.user, probe }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/endpointRunner.test.ts
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRunner, readResourceRefs } from './endpointRunner.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('readResourceRefs', () => {
  it('flattens the app package.json resourceReferencesByFile to unique display/type', () => {
    const refs = readResourceRefs('/Users/arsany.milad.ext/Projects/retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard')
    const names = refs.map((r) => r.displayName).sort()
    expect(names).toContain('Databricks')
    expect(names).toContain('Lakebase Retool - OLTP')
    expect(names).toContain('ConnectTeamAPI')
    expect(refs.filter((r) => r.displayName === 'Lakebase Retool - OLTP')).toHaveLength(1) // de-duped
  })
})

describe('createRunner', () => {
  it('injects globals and runs a backend endpoint by file name', async () => {
    ;(globalThis as any).fakeResource = { query: async () => ({ data: [{ ok: 1 }] }) }
    const runner = createRunner({ appDir: join(here, 'fixtures'), globals: {}, user: { email: 'dev@local' } })
    // point the runner at the fixtures dir; endpoint file is echoEndpoint.ts (no /backend/shift nesting in fixtures)
    const out: any = await runner.run('echoEndpoint', { a: 1 })
    expect(out.params).toEqual({ a: 1 })
    expect(out.user).toEqual({ email: 'dev@local' })
    expect(out.probe).toEqual({ data: [{ ok: 1 }] })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/endpointRunner.test.ts`
Expected: FAIL — cannot resolve `./endpointRunner.js`.

- [ ] **Step 4: Implement `src/endpointRunner.ts`**

```ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function readResourceRefs(appDir: string): Array<{ displayName: string; type: string }> {
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  const byFile = pkg?.retool?.app?.resourceReferencesByFile ?? {}
  const seen = new Set<string>()
  const out: Array<{ displayName: string; type: string }> = []
  for (const arr of Object.values<any>(byFile)) {
    for (const r of arr ?? []) {
      if (seen.has(r.displayName)) continue
      seen.add(r.displayName)
      out.push({ displayName: r.displayName, type: r.type })
    }
  }
  return out
}

export type Runner = { run(endpoint: string, params: unknown): Promise<unknown> }

export function createRunner(opts: { appDir: string; globals: Record<string, unknown>; user?: unknown }): Runner {
  for (const [k, v] of Object.entries(opts.globals)) (globalThis as any)[k] = v
  const cache = new Map<string, (req: any) => Promise<unknown>>()
  const user = opts.user ?? { email: 'dev@local', name: 'Local Dev' }

  async function load(endpoint: string) {
    if (cache.has(endpoint)) return cache.get(endpoint)!
    // fixtures live flat; real app endpoints under backend/shift/
    const candidates = [
      join(opts.appDir, 'backend', 'shift', `${endpoint}.ts`),
      join(opts.appDir, `${endpoint}.ts`),
    ]
    const file = candidates.find((c) => existsSync(c))
    if (!file) throw new Error(`endpoint not found: ${endpoint}`)
    const mod: any = await import(pathToFileURL(file).href)
    const fn = mod.default
    if (typeof fn !== 'function') throw new Error(`endpoint ${endpoint} has no default export`)
    cache.set(endpoint, fn)
    return fn
  }

  return {
    async run(endpoint, params) {
      const fn = await load(endpoint)
      return fn({ params, user })
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/endpointRunner.test.ts`
Expected: PASS.
(If the dynamic `import` of `.ts` fails under vitest, it is fine — vitest transforms TS. At server runtime the process is launched with `tsx`, which loads `.ts` imports.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: endpoint runner with global injection + TS import"
```

---

### Task 7: Vite virtual-hooks plugin

**Files:**
- Create: `src/vitePlugin.ts`
- Test: `src/vitePlugin.test.ts`

**Interfaces:**
- Produces: `hooksVirtualPlugin(opts: { appDir: string; endpoints: string[]; rpcBase?: string }): Plugin` — a Vite plugin whose `resolveId` matches any import ending in `hooks/backend/shift` (resolved from `<appDir>/frontend/...`) and whose `load` returns a module string exporting `use<Endpoint>` hooks. Also `hookModuleSource(endpoints, rpcBase): string` (pure, testable).
- Consumed by: Task 8.

- [ ] **Step 1: Write the failing test**

```ts
// src/vitePlugin.test.ts
import { describe, it, expect } from 'vitest'
import { hookModuleSource } from './vitePlugin.js'

describe('hookModuleSource', () => {
  it('emits a use-hook per endpoint with the trigger/result contract', () => {
    const src = hookModuleSource(['getShiftTimeline', 'classifyGap'], '/rpc')
    expect(src).toContain('export function useGetShiftTimeline()')
    expect(src).toContain('export function useClassifyGap()')
    expect(src).toContain('trigger:')
    expect(src).toContain('result:')
    expect(src).toContain("'/rpc/getShiftTimeline'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/vitePlugin.test.ts`
Expected: FAIL — cannot resolve `./vitePlugin.js`.

- [ ] **Step 3: Implement `src/vitePlugin.ts`**

```ts
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
  return {
    name: 'local-mcp-runner-hooks',
    resolveId(id, importer) {
      if (id.endsWith(marker) || id.endsWith(marker + '.ts')) return '\0virtual:' + marker
      return null
    },
    load(id) {
      if (id === '\0virtual:' + marker) return hookModuleSource(opts.endpoints, rpcBase)
      return null
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/vitePlugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Vite virtual-module plugin for generated backend hooks"
```

---

### Task 8: Server + CLI wiring (Vite middleware + /rpc + entry)

**Files:**
- Create: `src/server.ts`, `src/index.ts`, `index.html`, `src/appEntry.tsx`
- Test: `src/server.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `discoverEndpoints(appDir: string): string[]` — file names in `<appDir>/backend/shift/` with a `export default` (excludes `shared.ts`, `shiftBands.ts`).
  - `startServer(opts: { appDir: string; port: number; writes: boolean; mcp: McpClient }): Promise<{ url: string; close(): Promise<void> }>`.
- `src/index.ts` parses CLI: `--app`, `--port` (default 5174), `--writes`, connects MCP, calls `startServer`.

- [ ] **Step 1: Write the failing test for `discoverEndpoints`**

```ts
// src/server.test.ts
import { describe, it, expect } from 'vitest'
import { discoverEndpoints } from './server.js'

describe('discoverEndpoints', () => {
  it('finds default-export endpoints and excludes shared helpers', () => {
    const eps = discoverEndpoints('/Users/arsany.milad.ext/Projects/retool-ops/apps-v2/Stackdrop-Hangar/Shift Utilization Dashboard')
    expect(eps).toContain('getShiftTimeline')
    expect(eps).toContain('classifyGap')
    expect(eps).not.toContain('shared')
    expect(eps).not.toContain('shiftBands')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server.test.ts`
Expected: FAIL — cannot resolve `./server.js`.

- [ ] **Step 3: Implement `index.html` and `src/appEntry.tsx`**

`index.html` (tool root):
```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Local MCP Runner</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/appEntry.tsx"></script>
  </body>
</html>
```

`src/appEntry.tsx` (imports the app's App.tsx by absolute path — injected at build time via a define; here we read a global set by the plugin config):
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
// The app path is aliased to `@app/App` in vite config (Task 8 Step 4).
// eslint-disable-next-line
import App from '@app/App'
createRoot(document.getElementById('root')!).render(React.createElement(App))
```

- [ ] **Step 4: Implement `src/server.ts`**

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'
import { hooksVirtualPlugin } from './vitePlugin.js'
import { readResourceRefs, createRunner } from './endpointRunner.js'
import { resolveResources, buildGlobals } from './resourceGlobals.js'
import type { McpClient } from './mcpClient.js'

export function discoverEndpoints(appDir: string): string[] {
  const dir = join(appDir, 'backend', 'shift')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => /export\s+default/.test(readFileSync(join(dir, f), 'utf8')))
    .map((f) => f.replace(/\.ts$/, ''))
}

// Databricks/Lakebase .query() already returns {data}; keep raw unless probe proved otherwise.
const normalize = (raw: unknown) => raw

export async function startServer(opts: { appDir: string; port: number; writes: boolean; mcp: McpClient }) {
  const endpoints = discoverEndpoints(opts.appDir)
  const refs = readResourceRefs(opts.appDir)
  const map = await resolveResources(opts.mcp, refs)

  const app = express()
  app.use(express.json({ limit: '5mb' }))

  app.post('/rpc/:endpoint', async (req, res) => {
    const endpoint = req.params.endpoint
    const globals = buildGlobals(opts.mcp, map, { writes: opts.writes, endpoint, normalize })
    const runner = createRunner({ appDir: opts.appDir, globals })
    try {
      const result = await runner.run(endpoint, req.body?.params ?? {})
      res.json({ result })
    } catch (err: any) {
      res.status(400).json({ __error: true, error: String(err?.message ?? err) })
    }
  })

  const vite = await createViteServer({
    root: '/Users/arsany.milad.ext/Projects/local-mcp-runner',
    server: { middlewareMode: true },
    plugins: [react(), hooksVirtualPlugin({ appDir: opts.appDir, endpoints })],
    resolve: { alias: { '@app': join(opts.appDir, 'frontend') } },
  })
  app.use(vite.middlewares)

  return await new Promise<{ url: string; close(): Promise<void> }>((resolve) => {
    const server = app.listen(opts.port, () => {
      resolve({
        url: `http://localhost:${opts.port}`,
        close: async () => { await vite.close(); server.close() },
      })
    })
  })
}
```

Note: add `@vitejs/plugin-react` to `package.json` devDependencies (`^4.3.0`) and `npm install` before running.

- [ ] **Step 5: Implement `src/index.ts`**

```ts
import { DEFAULT_APP_DIR } from './paths.js'
import { connectMcp } from './mcpClient.js'
import { startServer } from './server.js'

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const has = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const appDir = arg('app', DEFAULT_APP_DIR)!
  const port = Number(arg('port', '5174'))
  const writes = has('writes')
  console.log(`[runner] app=${appDir}`)
  console.log(`[runner] mode=${writes ? 'READ-WRITE' : 'read-only'} (use --writes to enable writes)`)
  const mcp = await connectMcp()
  const { url } = await startServer({ appDir, port, writes, mcp })
  console.log(`[runner] serving ${url}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 6: Run the `discoverEndpoints` test to verify it passes**

Run: `npm test -- src/server.test.ts`
Expected: PASS.

- [ ] **Step 7: Install the react plugin and commit**

```bash
npm install --save-dev @vitejs/plugin-react@^4.3.0
git add -A && git commit -m "feat: server + CLI wiring (vite middleware, /rpc, entry)"
```

---

### Task 9: End-to-end live smoke + README

**Files:**
- Create: `README.md`
- (No new source; this task verifies the whole system live.)

**Interfaces:** none produced; this is the acceptance gate.

- [ ] **Step 1: Start the server in read-only mode**

Run: `cd /Users/arsany.milad.ext/Projects/local-mcp-runner && npm start`
Expected: `[runner] mode=read-only`, then `[runner] serving http://localhost:5174` (browser OAuth only if the token cache is empty/expired).

- [ ] **Step 2: Drive the read path via curl**

Run:
```bash
curl -s -X POST http://localhost:5174/rpc/getShiftTimeline \
  -H 'content-type: application/json' \
  -d '{"params":{"geo":"lhr","shift":"full"}}' | head -c 600
```
Expected: a JSON `{ "result": { "window": ..., "reasonCodes": [...], "vehicles": [...] } }`. If it errors, inspect `logs/queries-<today>.jsonl` for the exact SQL sent and the MCP error, and adjust `normalize` in `src/server.ts` if the result shape differs from `{data}` (per the Task 4 probe).

- [ ] **Step 3: Confirm the query history was written**

Run: `tail -n 3 /Users/arsany.milad.ext/Projects/local-mcp-runner/logs/queries-$(date +%F).jsonl`
Expected: JSONL lines with `endpoint`, `resourceNames`, the full `code`/SQL, `ok:true`, `rowCount`, `durationMs`.

- [ ] **Step 4: Confirm a write is blocked in read-only mode**

Run:
```bash
curl -s -X POST http://localhost:5174/rpc/invalidateGap \
  -H 'content-type: application/json' \
  -d '{"params":{"gapKey":"__probe__","vehicleName":"x","dateIso":"2026-07-16","airportCode":"lhr","gapStartUtc":"2026-07-16T00:00:00Z","note":null}}'
```
Expected: `{ "__error": true, "error": "Write blocked (read-only mode)..." }` and a `queries-*.jsonl` line only if the shim logs before throwing (it throws before the MCP call, so no log line — that's correct).

- [ ] **Step 5: Load the dashboard in a browser**

Open `http://localhost:5174` — the Shift Utilization Dashboard renders and populates from live data (read path). Classification buttons will fail with the block message until started with `--writes`.

- [ ] **Step 6: Write `README.md`**

```markdown
# local-mcp-runner

Runs a Retool apps-as-code app locally, using the Retool MCP as the backend/resource connection.

## Run
    npm install
    npm start                 # read-only (default)
    npm start -- --writes     # enable INSERT/UPDATE/DELETE via the MCP
    npm start -- --app "/abs/path/to/another/app" --port 5175

First run opens a browser for Retool MCP OAuth; tokens cache under `.mcp-auth/`.

## Query history
Every MCP `execute_resource_ts` call is appended to `logs/queries-YYYY-MM-DD.jsonl`
(resource, exact SQL/code, ok/error, rowCount, durationMs).

## How it works
- Vite (root = this dir) serves the app's `frontend/App.tsx` (aliased `@app`).
- The missing `hooks/backend/shift` import is served as an in-memory virtual module.
- Frontend hooks POST to `/rpc/:endpoint`; the runner executes `backend/shift/*.ts`
  with resource globals (`databricks`/`lakebaseRetoolOltp`/`connectteamapi`) that
  forward into `retool_execute_resource_ts`.
- Nothing is written into the retool-ops repo.
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "docs: README + verified end-to-end live smoke"
```

---

## Self-Review

**Spec coverage:**
- Zero repo writes → Task 7 (virtual module), Task 8 (alias, no scaffold files in app). ✓
- Standalone OAuth → Task 4. ✓
- Query history JSONL → Task 2, logged in Task 5, verified Task 9 Step 3. ✓
- Read-only default + `--writes` → Task 5 (gating), Task 8 (flag), verified Task 9 Step 4. ✓
- SQL + REST resource shims → Task 3 (builders), Task 5 (globals). ✓
- Endpoint execution of backend TS → Task 6. ✓
- Frontend served end-to-end → Task 8 + Task 9 Step 5. ✓
- Live probe to lock result shape → Task 4 Step 3-4; normalization hook threaded through Task 5/8. ✓
- Testing (unit pure fns + live smoke) → Tasks 2,3,5,6,7,8 unit; Task 9 live. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. The one intentional runtime-dependent item (result `normalize`) is a real, wired function defaulting to identity, with an explicit adjust-after-probe instruction — not a placeholder.

**Type consistency:** `McpClient`, `ResourceMap`, `Runner`, `QueryRecord`, `hookModuleSource`, `buildGlobals`, `resolveResources`, `createRunner`, `discoverEndpoints`, `readResourceRefs` names/signatures are consistent across tasks that consume them.

**Known runtime-verified assumptions (resolved during execution, not plan gaps):**
- Exact `execute_resource_ts` return shape and binding variable names → Task 4 probe.
- MCP OAuth dynamic-registration specifics → Task 4 (SDK standard flow).
- ConnectTeam op path shape → Task 5 proxy is generic; `deriveBands` falls back on error.
