import { describe, expect, it } from 'vitest'
import { parseTypecheckArgs, typecheckUsage } from './typecheckCli.js'

describe('typecheck CLI arguments', () => {
  it('uses the saved apps repository and accepts an app path relative to apps-v2', () => {
    expect(parseTypecheckArgs([
      '--',
      '--branch', 'feature/check',
      '--app', 'Operations/Example App',
      '--json',
    ], '/saved/repo')).toEqual({
      repoDir: '/saved/repo',
      branch: 'feature/check',
      app: 'Operations/Example App',
      json: true,
      help: false,
    })
  })

  it('lets an explicit repository override saved panel configuration', () => {
    expect(parseTypecheckArgs([
      '--repo', '/explicit/repo',
      '--branch', 'main',
      '--app', 'apps-v2/Operations/Example App',
    ], '/saved/repo').repoDir).toBe('/explicit/repo')
  })

  it('rejects flags with missing values before resolving a worktree', () => {
    expect(() => parseTypecheckArgs(['--branch', '--app', 'Example App'], '/repo')).toThrow(/missing value for --branch/)
  })

  it('documents the exact agent command', () => {
    expect(typecheckUsage()).toContain('pnpm typecheck -- --branch <branch> --app <app>')
    expect(typecheckUsage()).toContain('--json')
  })
})
