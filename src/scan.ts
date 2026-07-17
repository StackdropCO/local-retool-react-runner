import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { currentBranch, listBranches } from './git.js'

export type ScannedApp = {
  name: string
  path: string
  group: string
  endpoints: string[]
  resources: Array<{ displayName: string; type: string }>
  branch: string | null
  branches: string[]
}

// Walk up to `depth` levels under root, returning dirs that look like a Retool
// apps-as-code app: a package.json with retool.app + a frontend/App.tsx.
function findAppDirs(root: string, depth = 4): string[] {
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

function endpointsOf(appDir: string): string[] {
  const backend = join(appDir, 'backend')
  const out: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (e.endsWith('.ts') && /export\s+default/.test(readFileSync(p, 'utf8'))) out.push(e.replace(/\.ts$/, ''))
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
      return {
        name: app.name ?? parts[parts.length - 1],
        path,
        group: parts[parts.length - 2] ?? '',
        endpoints: endpointsOf(path),
        resources: Object.values(refs),
        branch: currentBranch(path),
        branches: listBranches(path),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
