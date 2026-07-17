import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, relative, basename, dirname } from 'node:path'
import { TOOL_ROOT } from './paths.js'

// Worktrees live OUTSIDE the tool dir (Vite's root) so a running app's Vite
// never crawls/reloads them. A hidden sibling folder keeps them off the repo too.
const WORKTREE_BASE = join(dirname(TOOL_ROOT), '.local-mcp-runner-worktrees')

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

export function isGitRepo(dir: string): boolean {
  try {
    git(dir, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

export function repoRoot(dir: string): string | null {
  try {
    return git(dir, ['rev-parse', '--show-toplevel'])
  } catch {
    return null
  }
}

export function currentBranch(dir: string): string | null {
  try {
    const b = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
    return b === 'HEAD' ? null : b // detached
  } catch {
    return null
  }
}

// Local branches + remote branches (origin/*), de-duplicated, current first.
export function listBranches(dir: string): string[] {
  try {
    const locals = git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean)
    const remotes = git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'])
      .split('\n')
      .filter(Boolean)
      .map((r) => r.replace(/^[^/]+\//, '')) // origin/foo -> foo
      .filter((r) => r !== 'HEAD')
    const cur = currentBranch(dir)
    const all = [...new Set([...locals, ...remotes])].sort((a, b) => a.localeCompare(b))
    return cur ? [cur, ...all.filter((b) => b !== cur)] : all
  } catch {
    return []
  }
}

// Parse `git worktree list --porcelain` → [{ path, branch }].
export function parseWorktreeList(porcelain: string): Array<{ path: string; branch: string | null }> {
  const out: Array<{ path: string; branch: string | null }> = []
  let cur: { path: string; branch: string | null } | null = null
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur)
      cur = { path: line.slice('worktree '.length), branch: null }
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '')
    }
  }
  if (cur) out.push(cur)
  return out
}

function existingWorktree(root: string, branch: string): string | null {
  try {
    const list = parseWorktreeList(git(root, ['worktree', 'list', '--porcelain']))
    return list.find((w) => w.branch === branch)?.path ?? null
  } catch {
    return null
  }
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '-')

/**
 * Return an absolute app dir that reflects `branch`, without touching the repo's
 * main working tree:
 *  - branch is the current branch (or empty)      → the app dir as-is
 *  - branch is already checked out in a worktree   → that worktree's app dir
 *  - otherwise                                     → create a worktree under
 *    TOOL_ROOT/.worktrees and return its app dir
 */
export function resolveAppForBranch(appDir: string, branch?: string): string {
  const root = repoRoot(appDir)
  if (!root || !branch || branch === currentBranch(root)) return appDir

  const rel = relative(root, appDir)
  let wt = existingWorktree(root, branch)
  if (!wt) {
    wt = join(WORKTREE_BASE, `${sanitize(basename(root))}__${sanitize(branch)}`)
    const hasLocal = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
      .split('\n')
      .includes(branch)
    if (existsSync(wt)) {
      // reuse dir but make sure it's on the right branch
      git(wt, ['checkout', branch])
    } else if (hasLocal) {
      git(root, ['worktree', 'add', wt, branch])
    } else {
      // remote-only branch: create a local tracking branch in the worktree
      git(root, ['worktree', 'add', '--track', '-b', branch, wt, `origin/${branch}`])
    }
  }
  return join(wt, rel)
}
