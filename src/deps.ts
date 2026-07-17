import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { TOOL_ROOT } from './paths.js'

// Pure: given the app's frontend deps and a "is this installed?" probe, return
// the `name@version` specs that are missing.
export function computeMissing(deps: Record<string, string>, has: (name: string) => boolean): string[] {
  return Object.entries(deps)
    .filter(([name]) => !has(name))
    .map(([name, version]) => `${name}@${version}`)
}

// Ensure every dependency of the app's frontend is installed in the tool's
// node_modules (Vite resolves the external app's bare imports from here).
export function ensureFrontendDeps(appDir: string, toolRoot: string = TOOL_ROOT): void {
  const pkgPath = join(appDir, 'frontend', 'package.json')
  if (!existsSync(pkgPath)) return
  const deps: Record<string, string> = JSON.parse(readFileSync(pkgPath, 'utf8')).dependencies ?? {}
  const has = (name: string) => existsSync(join(toolRoot, 'node_modules', name, 'package.json'))
  const missing = computeMissing(deps, has)
  if (!missing.length) {
    console.log('[runner] frontend deps: all present')
    return
  }
  console.log(`[runner] installing ${missing.length} missing frontend dep(s): ${missing.join(', ')}`)
  execFileSync('npm', ['install', '--no-save', ...missing], { cwd: toolRoot, stdio: 'inherit' })
}
