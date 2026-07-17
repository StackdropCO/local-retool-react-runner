import { describe, it, expect } from 'vitest'
import { parseWorktreeList } from './git.js'

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
      { path: '/repo', branch: 'main' },
      { path: '/tool/.worktrees/repo__feature-x', branch: 'feature-x' },
      { path: '/tool/.worktrees/detached', branch: null },
    ])
  })
})
