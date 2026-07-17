import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ResourceRef } from './resourceGlobals.js'

// Recursively collect *.ts files under a directory.
export function walkTs(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walkTs(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

export function readResourceRefs(appDir: string): ResourceRef[] {
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  const byFile = pkg?.retool?.app?.resourceReferencesByFile ?? {}
  const seen = new Set<string>()
  const out: ResourceRef[] = []
  for (const arr of Object.values<any>(byFile)) {
    for (const r of arr ?? []) {
      if (seen.has(r.displayName)) continue
      seen.add(r.displayName)
      out.push({ name: r.name, displayName: r.displayName, type: r.type })
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
    // fixtures live flat; real app endpoints live anywhere under backend/**.
    const flat = join(opts.appDir, `${endpoint}.ts`)
    const file = existsSync(flat)
      ? flat
      : walkTs(join(opts.appDir, 'backend')).find((f) => f.endsWith(`/${endpoint}.ts`))
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
