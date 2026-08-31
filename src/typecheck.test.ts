import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatTypecheckResult, resolveTypecheckTarget, typecheckApp } from './typecheck.js'

const temporaryDirectories: string[] = []

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function createApp(root: string, source: { backend?: string; frontend?: string } = {}) {
  const app = join(root, 'apps-v2', 'Operations', 'Example App')
  mkdirSync(join(app, 'backend', 'reports'), { recursive: true })
  mkdirSync(join(app, 'frontend'), { recursive: true })
  writeFileSync(join(app, 'package.json'), JSON.stringify({
    retool: { app: { resourceReferencesByFile: {
      '/backend/reports/load.ts': [{ name: 'db-uuid', displayName: 'Warehouse DB', type: 'postgresql' }],
    } } },
  }))
  writeFileSync(join(app, 'backend', 'reports', 'load.ts'), source.backend ?? [
    'export default async function load(req: { params: { limit: number }; user: User }) {',
    '  return warehouseDb.query<{ id: number }>("SELECT 1", [req.params.limit])',
    '}',
  ].join('\n'))
  writeFileSync(join(app, 'frontend', 'App.tsx'), source.frontend ?? [
    "import { useState } from 'react'",
    "import { useLoad } from './hooks/backend/reports'",
    'export default function App() {',
    '  const [count] = useState(0)',
    '  const query = useLoad()',
    '  query.trigger({ limit: count + 1 })',
    '  return null',
    '}',
  ].join('\n'))
  return app
}

function repositoryWithFeatureWorktree() {
  const parent = mkdtempSync(join(tmpdir(), 'local-mcp-typecheck-'))
  temporaryDirectories.push(parent)
  const main = join(parent, 'repo')
  const feature = join(parent, 'feature')
  mkdirSync(main)
  git(main, ['init', '-b', 'main'])
  createApp(main)
  git(main, ['add', '.'])
  git(main, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'])
  git(main, ['worktree', 'add', '-b', 'feature/check', feature])
  return { main, feature }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('resolveTypecheckTarget', () => {
  it('resolves the app in the exact registered branch worktree without switching branches', () => {
    const { main, feature } = repositoryWithFeatureWorktree()

    const target = resolveTypecheckTarget({
      repoDir: main,
      branch: 'feature/check',
      app: 'apps-v2/Operations/Example App',
    })

    expect(target).toEqual({
      appDir: realpathSync(join(feature, 'apps-v2', 'Operations', 'Example App')),
      branch: 'feature/check',
      worktreePath: realpathSync(feature),
    })
    expect(git(main, ['branch', '--show-current'])).toBe('main')
    expect(git(feature, ['branch', '--show-current'])).toBe('feature/check')
  })

  it('rejects branches without an existing worktree', () => {
    const { main } = repositoryWithFeatureWorktree()
    expect(() => resolveTypecheckTarget({
      repoDir: main,
      branch: 'missing',
      app: 'apps-v2/Operations/Example App',
    })).toThrow(/no registered worktree for branch "missing"/)
  })
})

describe('typecheckApp', () => {
  it('checks backend resource globals and frontend Retool hooks without writing generated files into the app', () => {
    const root = mkdtempSync(join(tmpdir(), 'local-mcp-typecheck-app-'))
    temporaryDirectories.push(root)
    const app = createApp(root)
    const before = readdirSync(app, { recursive: true }).sort()

    const result = typecheckApp(app)

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(readdirSync(app, { recursive: true }).sort()).toEqual(before)
  })

  it('returns agent-friendly file and line diagnostics with a failing result', () => {
    const root = mkdtempSync(join(tmpdir(), 'local-mcp-typecheck-error-'))
    temporaryDirectories.push(root)
    const app = createApp(root, {
      frontend: 'const count: number = "wrong"\nexport default function App() { return count }\n',
    })

    const result = typecheckApp(app)
    const output = formatTypecheckResult(result, false)

    expect(result.ok).toBe(false)
    expect(output).toMatch(/frontend\/App\.tsx:1:\d+ - error TS2322/)
    expect(output).toContain("Type 'string' is not assignable to type 'number'.")
  })

  it('formats stable JSON for agents', () => {
    const root = mkdtempSync(join(tmpdir(), 'local-mcp-typecheck-json-'))
    temporaryDirectories.push(root)
    const app = createApp(root)

    const output = JSON.parse(formatTypecheckResult(typecheckApp(app), true))

    expect(output).toMatchObject({ ok: true, appDir: realpathSync(app), errorCount: 0, diagnostics: [] })
  })
})
