import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

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

export type WorktreeInfo = {
  path: string
  branch: string | null
  head: string
  dirty: boolean
}

export type ParsedWorktree = Omit<WorktreeInfo, 'dirty'>

// Parse `git worktree list --porcelain` without inferring state from folder names.
export function parseWorktreeList(porcelain: string): ParsedWorktree[] {
  const out: ParsedWorktree[] = []
  let cur: ParsedWorktree | null = null
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur)
      cur = { path: line.slice('worktree '.length), branch: null, head: '' }
    } else if (line.startsWith('HEAD ') && cur) {
      cur.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '')
    }
  }
  if (cur) out.push(cur)
  return out
}

export function listWorktrees(dir: string): WorktreeInfo[] {
  try {
    const root = repoRoot(dir)
    if (!root) return []
    return parseWorktreeList(git(root, ['worktree', 'list', '--porcelain'])).map((worktree) => ({
      ...worktree,
      dirty: git(worktree.path, ['status', '--porcelain']).length > 0,
    }))
  } catch {
    return []
  }
}

/**
 * Verify that a run target belongs to the exact registered worktree selected
 * by the panel. This function is deliberately read-only: mismatches fail
 * instead of checking out a branch or creating/repairing a worktree.
 */
export function validateWorktreeTarget(appPath: string, expectedWorktreePath: string, expectedBranch: string): WorktreeInfo {
  if (!existsSync(appPath)) throw new Error(`app path not found: ${appPath}`)
  const actualRoot = repoRoot(appPath)
  if (!actualRoot) throw new Error(`app path is not inside a Git worktree: ${appPath}`)
  const canonical = (path: string) => realpathSync.native(resolve(path))
  if (canonical(actualRoot) !== canonical(expectedWorktreePath)) {
    throw new Error(`worktree path mismatch: expected ${expectedWorktreePath}, got ${actualRoot}`)
  }
  const worktree = listWorktrees(actualRoot).find((item) => canonical(item.path) === canonical(actualRoot))
  if (!worktree) throw new Error(`unregistered Git worktree: ${actualRoot}`)
  if ((worktree.branch ?? '') !== expectedBranch) {
    throw new Error(`branch mismatch: expected ${expectedBranch || '(detached)'}, got ${worktree.branch || '(detached)'}`)
  }
  return worktree
}
