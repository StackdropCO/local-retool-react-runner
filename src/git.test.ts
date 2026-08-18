import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, expect } from 'vitest'
import { listWorktrees, parseWorktreeList, validateWorktreeTarget } from './git.js'

const temporaryDirectories: string[] = []

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function repositoryWithFeatureWorktree() {
  const parent = mkdtempSync(join(tmpdir(), 'local-mcp-runner-git-'))
  temporaryDirectories.push(parent)
  const main = join(parent, 'repo')
  const feature = join(parent, 'feature')
  mkdirSync(main)
  git(main, ['init', '-b', 'main'])
  writeFileSync(join(main, 'README.md'), 'test\n')
  git(main, ['add', 'README.md'])
  git(main, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'])
  git(main, ['worktree', 'add', '-b', 'feature', feature])
  return { main, feature }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('parseWorktreeList', () => {
  it('pairs each worktree path with its branch', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /tool/.worktrees/repo__feature-x',
      'HEAD def',
      'branch refs/heads/feature-x',
      '',
      'worktree /tool/.worktrees/detached',
      'HEAD 123',
      'detached',
    ].join('\n')
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: '/repo', branch: 'main', head: 'abc' },
      { path: '/tool/.worktrees/repo__feature-x', branch: 'feature-x', head: 'def' },
      { path: '/tool/.worktrees/detached', branch: null, head: '123' },
    ])
  })
})

describe('worktree targets', () => {
  it('lists registered worktrees with their exact path, commit, and dirty state', () => {
    const { main, feature } = repositoryWithFeatureWorktree()
    writeFileSync(join(feature, 'README.md'), 'agent edit\n')

    expect(listWorktrees(main)).toEqual([
      expect.objectContaining({ path: realpathSync(main), branch: 'main', dirty: false }),
      expect.objectContaining({ path: realpathSync(feature), branch: 'feature', dirty: true }),
    ])
    expect(listWorktrees(main).every((worktree) => /^[0-9a-f]{40}$/.test(worktree.head))).toBe(true)
  })

  it('validates the exact worktree without switching either branch', () => {
    const { main, feature } = repositoryWithFeatureWorktree()

    expect(validateWorktreeTarget(feature, feature, 'feature')).toEqual(
      expect.objectContaining({ path: realpathSync(feature), branch: 'feature' }),
    )
    expect(() => validateWorktreeTarget(main, feature, 'feature')).toThrow(/worktree path mismatch/)
    expect(() => validateWorktreeTarget(feature, feature, 'main')).toThrow(/branch mismatch/)
    expect(git(main, ['branch', '--show-current'])).toBe('main')
    expect(git(feature, ['branch', '--show-current'])).toBe('feature')
  })
})
