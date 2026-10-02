import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { currentBranch, listBranches, listWorktrees, repoRoot } from './git.js'

export type AppWorktree = {
  worktreePath: string
  appPath: string
  branch: string | null
  head: string
  dirty: boolean
  cliCheckout: boolean
}

export type ScannedApp = {
  uuid?: string
  name: string
  path: string
  group: string
  endpoints: string[]
  resources: Array<{ displayName: string; type: string }>
  branch: string | null
  branches: string[]
  worktrees: AppWorktree[]
}

// Walk up to `depth` levels under root, returning dirs that look like a Retool
// apps-as-code app: a package.json with retool.app + a frontend/App.tsx.
export function findAppDirs(root: string, depth = 4): string[] {
  const out: string[] = []
  const walk = (dir: string, level: number) => {
    if (level > depth || !existsSync(dir)) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    if (entries.includes('package.json') && existsSync(join(dir, 'frontend', 'App.tsx'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        if (pkg?.retool?.app) {
          out.push(dir)
          return // don't descend into an app
        }
      } catch {
        /* not a valid app package.json */
      }
    }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue
      const p = join(dir, e)
      try {
        if (statSync(p).isDirectory()) walk(p, level + 1)
      } catch {
        /* unreadable */
      }
    }
  }
  walk(root, 0)
  return out
}

const canonical = (path: string) => realpathSync.native(resolve(path))

/**
 * Resolve an app from a Retool CLI checkout or any ordinary source directory.
 * Absolute app paths remain supported. Relative names are tried both directly
 * below the source root and below its conventional apps-v2 directory.
 */
export function resolveAppDirectory(sourceDir: string, app = ''): string {
  if (!sourceDir && !isAbsolute(app)) {
    throw new Error('no app source configured; pass --checkout "/path/to/retool-checkout" or an absolute --app path')
  }
  const sourceRoot = sourceDir ? canonical(sourceDir) : ''
  const candidates = app
    ? isAbsolute(app)
      ? [resolve(app)]
      : [resolve(sourceRoot, app), resolve(sourceRoot, 'apps-v2', app)]
    : findAppDirs(sourceRoot)
  const matches = [...new Set(candidates)]
    .filter((candidate) => existsSync(join(candidate, 'frontend', 'App.tsx')))
    .map(canonical)
  if (!matches.length) {
    throw new Error(app
      ? `Retool React app not found: ${app}`
      : `no Retool React apps found under checkout: ${sourceRoot}`)
  }
  if (!app && matches.length > 1) {
    throw new Error(`multiple Retool React apps found under checkout; pass --app with one of: ${matches.join(', ')}`)
  }
  return matches[0]!
}

export function validateDirectoryTarget(appPath: string, expectedRoot: string): void {
  if (!expectedRoot) throw new Error('app source directory required')
  const root = canonical(expectedRoot)
  const app = canonical(appPath)
  const fromRoot = relative(root, app)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`app path is outside the selected source directory: ${app}`)
  }
  if (!existsSync(join(app, 'frontend', 'App.tsx'))) {
    throw new Error(`not a Retool React app (missing frontend/App.tsx): ${app}`)
  }
}

function endpointsOf(appDir: string): string[] {
  const backend = join(appDir, 'backend')
  const out: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (e.endsWith('.ts') && !e.endsWith('.d.ts') && /export\s+default/.test(readFileSync(p, 'utf8'))) out.push(e.replace(/\.ts$/, ''))
    }
  }
  walk(backend)
  return out
}

export function scanApps(repoDir: string): ScannedApp[] {
  return findAppDirs(repoDir)
    .map((path) => {
      const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
      const app = pkg.retool.app
      const refs: Record<string, { displayName: string; type: string }> = {}
      for (const arr of Object.values<any>(app.resourceReferencesByFile ?? {})) {
        for (const r of arr ?? []) refs[r.displayName] = { displayName: r.displayName, type: r.type }
      }
      // group = the parent dir name (e.g. "Stackdrop-Hangar")
      const parts = path.split('/')
      const root = repoRoot(path)
      const relativeAppPath = root ? relative(root, realpathSync(path)) : ''
      const worktrees = root
        ? listWorktrees(root)
            .map((worktree) => ({
              worktreePath: worktree.path,
              appPath: join(worktree.path, relativeAppPath),
              branch: worktree.branch,
              head: worktree.head,
              dirty: worktree.dirty,
              cliCheckout: existsSync(join(worktree.path, '.retool', 'app.json'))
                || existsSync(join(worktree.path, relativeAppPath, '.retool', 'app.json')),
            }))
            .filter((worktree) => existsSync(join(worktree.appPath, 'package.json')) && existsSync(join(worktree.appPath, 'frontend', 'App.tsx')))
        : [{
            worktreePath: canonical(path),
            appPath: canonical(path),
            branch: null,
            head: '',
            dirty: false,
            cliCheckout: existsSync(join(path, '.retool', 'app.json')),
          }]
      return {
        uuid: typeof app.uuid === 'string' ? app.uuid : undefined,
        name: app.name ?? parts[parts.length - 1],
        path: canonical(path),
        group: parts[parts.length - 2] ?? '',
        endpoints: endpointsOf(path),
        resources: Object.values(refs),
        branch: currentBranch(path),
        branches: listBranches(path),
        worktrees,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
