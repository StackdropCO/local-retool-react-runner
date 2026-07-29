# Control Panel shadcn/ui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline control panel with a tested React + shadcn/ui interface, preserve every existing panel API contract, and remove organization-specific detail from the public README.

**Architecture:** Express continues to own `/api/*`, runner processes, and port 5170. A Vite middleware mounted after the API routes serves a React panel from `src/panel/ui`; a typed client isolates fetch behavior, while `PanelApp` owns orchestration and focused components own presentation.

**Tech Stack:** React 19, TypeScript, Vite 6, Tailwind CSS 4, shadcn/ui source components, Radix UI, Lucide React, Vitest, Testing Library, jsdom

## Global Constraints

- Preserve all existing Express routes, request payloads, and response shapes.
- Keep read-only mode as the default.
- Require explicit confirmation before launching an app with writes enabled.
- Use a neutral shadcn palette, restrained primary accent, Lucide icons, and responsive one/two-column layouts.
- Dark mode, query-log browsing, and backend behavior changes are out of scope.
- Keep all changes local; do not push.
- Remove organization-, employee-, path-, resource-ID-, and incident-specific detail from `README.md`.

---

### Task 1: Typed panel API client

**Files:**
- Create: `src/panel/ui/lib/types.ts`
- Create: `src/panel/ui/lib/api.ts`
- Test: `src/panel/ui/lib/api.test.ts`

**Interfaces:**
- Produces: `panelApi` with `status`, `saveMcpUrl`, `authorize`, `resources`, `browse`, `scan`, `run`, `running`, and `stop` methods.
- Produces: `PanelStatus`, `Resource`, `ScannedApp`, `RunningApp`, and `BrowseResult` types used by all later tasks.

- [ ] **Step 1: Write failing API client tests**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPanelApi } from './api'

describe('panel API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('throws the API error message for a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid URL' }),
    }))
    await expect(createPanelApi().saveMcpUrl('bad')).rejects.toThrow('invalid URL')
  })

  it('sends the existing run payload unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ port: 5174, url: 'http://localhost:5174' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await createPanelApi().run({
      appPath: '/repo/apps-v2/Group/App',
      name: 'App',
      branch: 'main',
      writes: false,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/run', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        appPath: '/repo/apps-v2/Group/App',
        name: 'App',
        branch: 'main',
        writes: false,
      }),
    }))
  })
})
```

- [ ] **Step 2: Run the tests and verify red**

Run: `pnpm vitest run src/panel/ui/lib/api.test.ts`  
Expected: FAIL because `./api` does not exist.

- [ ] **Step 3: Implement types and API methods**

```ts
export interface PanelStatus {
  mcpUrl: string
  cachedAuth: boolean
  connected: boolean
  repoDir: string
}

export interface Resource {
  name: string
  displayName: string
  type: string
  readable: boolean
  note: string
}

export interface ScannedApp {
  name: string
  group: string
  path: string
  branch: string
  branches: string[]
  endpoints: string[]
  resources: Array<{ displayName: string }>
}

export interface RunningApp {
  name: string
  appPath: string
  branch: string
  port: number
  url: string
  writes: boolean
}

export interface BrowseResult {
  dir: string
  parent: string | null
  dirs: string[]
  isRepo: boolean
}
```

```ts
const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const createPanelApi = () => ({
  status: () => request<PanelStatus>('/api/status'),
  saveMcpUrl: (mcpUrl: string) => post('/api/mcp-url', { mcpUrl }),
  authorize: () => post('/api/auth'),
  resources: () => request<{ resources: Resource[] }>('/api/resources'),
  browse: (dir: string) => request<BrowseResult>(`/api/browse?dir=${encodeURIComponent(dir)}`),
  scan: (repoDir: string) => post<{ apps: ScannedApp[]; repoDir: string }>('/api/scan', { repoDir }),
  run: (input: { appPath: string; name: string; branch: string; writes: boolean }) => post('/api/run', input),
  running: () => request<{ apps: RunningApp[] }>('/api/running'),
  stop: (port: number) => post<{ stopped: number }>('/api/stop', { port }),
})

export const panelApi = createPanelApi()
```

- [ ] **Step 4: Run API tests**

Run: `pnpm vitest run src/panel/ui/lib/api.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panel/ui/lib
git commit -m "test: add typed panel API client"
```

### Task 2: React, Tailwind, and shadcn foundation

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vitest.config.ts`
- Modify: `src/panel.ts`
- Modify: `src/panel/server.ts`
- Delete: `src/panel/index.html`
- Create: `src/panel/ui/index.html`
- Create: `src/panel/ui/main.tsx`
- Create: `src/panel/ui/styles.css`
- Create: `src/panel/ui/lib/utils.ts`
- Create: `src/panel/ui/components/ui/button.tsx`
- Create: `src/panel/ui/components/ui/badge.tsx`
- Create: `src/panel/ui/components/ui/card.tsx`
- Create: `src/panel/ui/components/ui/input.tsx`
- Create: `src/panel/ui/components/ui/alert.tsx`
- Create: `src/panel/ui/components/ui/dialog.tsx`
- Create: `src/panel/ui/components/ui/select.tsx`
- Create: `src/panel/ui/components/ui/switch.tsx`
- Create: `src/panel/ui/components/ui/table.tsx`
- Create: `src/panel/ui/components/ui/skeleton.tsx`
- Test: `src/panel/server.test.ts`

**Interfaces:**
- Consumes: React dependencies already present in `package.json`.
- Produces: `startPanel(port): Promise<void>` with the same CLI behavior.
- Produces: reusable shadcn primitives and `cn(...inputs)` utility.

- [ ] **Step 1: Add a failing panel-shell server assertion**

Add to `src/panel/server.test.ts` a source-level assertion that the old HTML reader
is gone and Vite middleware is configured after `/api/*` route setup:

```ts
it('serves the React panel through Vite middleware', () => {
  const source = readFileSync(new URL('./panel/server.ts', import.meta.url), 'utf8')
  expect(source).toContain("root: join(HERE, 'ui')")
  expect(source).toContain('middlewareMode: true')
  expect(source).not.toContain("readFileSync(join(HERE, 'index.html')")
})
```

- [ ] **Step 2: Run the server test and verify red**

Run: `pnpm vitest run src/server.test.ts`  
Expected: FAIL on the new Vite middleware assertions.

- [ ] **Step 3: Install the UI and test dependencies**

Run:

```bash
pnpm add -D tailwindcss @tailwindcss/vite jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Expected: `package.json` and `pnpm-lock.yaml` include the packages.

- [ ] **Step 4: Add the shadcn utility and primitives**

Implement `cn` with `clsx` and `tailwind-merge`:

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
```

Add shadcn source components using existing Radix packages, `class-variance-authority`,
and the local `cn` helper. Export stable names such as `Button`, `Badge`, `Card`,
`Alert`, `Dialog`, `Select`, `Switch`, `Table`, and `Skeleton`.

- [ ] **Step 5: Add the panel entry and theme**

`src/panel/ui/index.html` contains `#root` and loads `/main.tsx`.
`main.tsx` renders `<PanelApp />` inside `React.StrictMode`.
`styles.css` imports Tailwind and defines the shadcn CSS variables:

```css
@import "tailwindcss";

:root {
  --radius: 0.625rem;
  --background: oklch(0.985 0.002 247.8);
  --foreground: oklch(0.21 0.034 264.7);
  --card: oklch(1 0 0);
  --card-foreground: var(--foreground);
  --primary: oklch(0.45 0.18 264);
  --primary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.96 0.006 264);
  --muted-foreground: oklch(0.52 0.03 264);
  --border: oklch(0.91 0.012 264);
  --input: var(--border);
  --ring: oklch(0.62 0.18 264);
  --destructive: oklch(0.58 0.22 27);
}
```

- [ ] **Step 6: Mount Vite after the API routes**

Make `startPanel` async, create Vite with `root: join(HERE, 'ui')`,
`server.middlewareMode: true`, React and Tailwind plugins, then mount
`vite.middlewares` after `/api/stop`. Change `src/panel.ts` to:

```ts
await startPanel(Number(arg('port', '5170')))
```

The SIGINT handler closes both the HTTP server and Vite.

- [ ] **Step 7: Run foundation tests and typecheck**

Run:

```bash
pnpm vitest run src/server.test.ts
pnpm exec tsc --noEmit
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/panel.ts src/panel
git commit -m "feat: add React shadcn panel foundation"
```

### Task 3: Status-first panel workflow

**Files:**
- Create: `src/panel/ui/PanelApp.tsx`
- Create: `src/panel/ui/PanelApp.test.tsx`
- Create: `src/panel/ui/test/setup.ts`
- Create: `src/panel/ui/components/app-header.tsx`
- Create: `src/panel/ui/components/connection-card.tsx`
- Create: `src/panel/ui/components/resource-card.tsx`
- Create: `src/panel/ui/components/repository-card.tsx`
- Create: `src/panel/ui/components/directory-browser.tsx`
- Create: `src/panel/ui/components/discovered-apps.tsx`
- Create: `src/panel/ui/components/app-card.tsx`
- Create: `src/panel/ui/components/running-apps.tsx`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `panelApi`, the types from Task 1, and UI primitives from Task 2.
- Produces: `PanelApp({ api? })`, with optional injected API for deterministic tests.

- [ ] **Step 1: Configure DOM tests**

Include `.test.tsx` files and `src/panel/ui/test/setup.ts` in Vitest. The setup file
imports `@testing-library/jest-dom/vitest`.

- [ ] **Step 2: Write failing workflow tests**

Cover the critical contract in `PanelApp.test.tsx`:

```tsx
it('loads status and running apps on startup', async () => {
  const api = fakeApi()
  render(<PanelApp api={api} />)
  expect(api.status).toHaveBeenCalledOnce()
  expect(api.running).toHaveBeenCalledOnce()
  expect(await screen.findByText('Connected')).toBeInTheDocument()
})

it('scans a repository and runs the selected branch read-only', async () => {
  const user = userEvent.setup()
  const api = fakeApi()
  render(<PanelApp api={api} />)
  await user.clear(screen.getByLabelText('Apps repository'))
  await user.type(screen.getByLabelText('Apps repository'), '/repo')
  await user.click(screen.getByRole('button', { name: 'Scan apps' }))
  await user.selectOptions(await screen.findByLabelText('Branch for Example App'), 'feature')
  await user.click(screen.getByRole('button', { name: 'Run Example App' }))
  expect(api.run).toHaveBeenCalledWith(expect.objectContaining({
    appPath: '/repo/apps-v2/Group/Example App',
    branch: 'feature',
    writes: false,
  }))
})

it('requires confirmation before enabling writes', async () => {
  const user = userEvent.setup()
  const api = fakeApi()
  render(<PanelApp api={api} />)
  await user.click(await screen.findByRole('switch', { name: 'Enable writes for Example App' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('production data')
  expect(api.run).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Run workflow tests and verify red**

Run: `pnpm vitest run src/panel/ui/PanelApp.test.tsx`  
Expected: FAIL because `PanelApp` and its components do not exist.

- [ ] **Step 4: Implement initial loading and header**

`PanelApp` fetches `status` and `running` concurrently in `useEffect`, stores errors
independently, and passes aggregate state to `AppHeader`. The header renders textual
badges for MCP connection, token cache, repository selection, and running app count.

- [ ] **Step 5: Implement connection and resource cards**

`ConnectionCard` owns the editable MCP URL and calls `saveMcpUrl` and `authorize`.
`ResourceCard` loads resources on demand and renders readable status with text plus icons.
Both disable only the active action and keep errors in local `Alert` components.

- [ ] **Step 6: Implement repository browser and scanning**

`RepositoryCard` controls the repo path, scanning, and `DirectoryBrowser` dialog.
Directory navigation calls `api.browse(dir)`. Selecting a folder updates the path and
starts a scan. Empty results show a next-action message rather than an empty container.

- [ ] **Step 7: Implement app cards and write confirmation**

Each `AppCard` owns its branch and requested write mode. Switching writes on opens an
`AlertDialog`; cancel leaves the switch off, and confirm enables it. Run calls:

```ts
onRun({
  appPath: app.path,
  name: app.name,
  branch: selectedBranch,
  writes,
})
```

Write-enabled cards display a persistent amber `Writes enabled` badge.

- [ ] **Step 8: Implement running apps**

Render running apps in the persistent right column. `Open` is a normal anchor with
`target="_blank"` and `rel="noreferrer"`. `Stop` is destructive, disables during its
request, refreshes the running list after success, and retains a visible error after
failure.

- [ ] **Step 9: Run UI tests**

Run: `pnpm vitest run src/panel/ui/PanelApp.test.tsx`  
Expected: PASS.

- [ ] **Step 10: Run the complete automated suite**

Run:

```bash
pnpm exec tsc --noEmit
pnpm test
```

Expected: typecheck and all tests pass.

- [ ] **Step 11: Commit**

```bash
git add vitest.config.ts src/panel/ui
git commit -m "feat: redesign the control panel workflow"
```

### Task 4: Public README anonymization

**Files:**
- Modify: `README.md`

**Interfaces:**
- No code interface changes.
- Produces: public documentation that explains generic SQL and REST resources without
  naming a customer, employee, private endpoint, internal incident, or specific vendor.

- [ ] **Step 1: Add an anonymity scan command**

Run:

```bash
rg -n -i "wayve|stackdrop|arsany|milad|ops\\.wayve|/Users/|ConnectTeam|Shift Utilization|gap classifications|reason codes" README.md
```

Expected before editing: matches for integration-specific terms such as `ConnectTeam`,
`gap classifications`, or `reason codes`; no person or organization should remain after
the edit.

- [ ] **Step 2: Rewrite integration-specific examples**

Use generic examples:

- `sqlWarehouse.query(sql)` for SQL resources.
- `operationalDb.query(sql)` for transactional SQL.
- `businessApi.namespace.operation(...)` for OpenAPI REST.
- `/path/to/apps-repo` for local directories.

Remove the dated “Status (verified …, live)” and “Known gap” sections because they
describe one organization’s resources and production incident. Replace them with a
generic “Compatibility” section listing supported resource categories and the general
warning that complex queries may hit connector timeouts.

- [ ] **Step 3: Verify anonymity**

Run:

```bash
rg -n -i "wayve|stackdrop|arsany|milad|ops\\.wayve|/Users/|ConnectTeam|Shift Utilization|gap classifications|reason codes|[0-9a-f]{8}-[0-9a-f-]{27,}" README.md
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: anonymize public README"
```

### Task 5: Final verification

**Files:**
- Verify only; modify files only when a check exposes a defect.

**Interfaces:**
- Confirms all preceding tasks as one releasable local branch.

- [ ] **Step 1: Run static and unit checks**

Run:

```bash
pnpm exec tsc --noEmit
pnpm test
git diff --check origin/main...HEAD
```

Expected: all commands exit zero.

- [ ] **Step 2: Start the panel locally**

Run: `pnpm panel -- --port 5171`  
Expected: log prints `control panel: http://localhost:5171`.

- [ ] **Step 3: Smoke-test the HTTP surface**

Run:

```bash
curl -fsS http://localhost:5171/api/status
curl -fsS http://localhost:5171/
```

Expected: status returns JSON; `/` returns the Vite-transformed React HTML shell.

- [ ] **Step 4: Check repository state**

Run:

```bash
git status -sb
git log --oneline --decorate -8
```

Expected: a clean local `main` branch ahead of `origin/main`; no push is performed.
