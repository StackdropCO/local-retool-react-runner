import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readConfig } from './config.js'
import { formatTypecheckResult, resolveTypecheckTarget, typecheckApp } from './typecheck.js'

export type TypecheckArgs = {
  repoDir: string
  branch: string
  app: string
  json: boolean
  help: boolean
}

export function typecheckUsage(): string {
  return [
    'Typecheck one Retool React app in an existing branch worktree.',
    '',
    'Usage:',
    '  pnpm typecheck -- --branch <branch> --app <app> [--repo <apps-repo>] [--json]',
    '',
    'Examples:',
    '  pnpm typecheck -- --branch feature/report --app "Operations/Report App"',
    '  pnpm typecheck -- --repo "/path/to/apps" --branch main --app "apps-v2/Operations/Report App" --json',
    '',
    'The branch must already have a registered Git worktree. The command never',
    'checks out a branch and never writes generated files into the app repository.',
  ].join('\n')
}

export function parseTypecheckArgs(argv: string[], savedRepoDir = ''): TypecheckArgs {
  const values = new Map<string, string>()
  let json = false
  let help = false
  const valueFlags = new Set(['--repo', '--branch', '--app'])
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (token === '--') continue
    if (token === '--json') {
      json = true
      continue
    }
    if (token === '--help' || token === '-h') {
      help = true
      continue
    }
    if (!valueFlags.has(token)) throw new Error(`unknown argument: ${token}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${token}`)
    values.set(token, value)
    index++
  }
  return {
    repoDir: values.get('--repo') ?? savedRepoDir,
    branch: values.get('--branch') ?? '',
    app: values.get('--app') ?? '',
    json,
    help,
  }
}

type Output = { log(message: string): void; error(message: string): void }

export function runTypecheckCli(
  argv: string[] = process.argv.slice(2),
  output: Output = console,
  savedRepoDir: string = readConfig().repoDir ?? '',
): number {
  let json = argv.includes('--json')
  try {
    const args = parseTypecheckArgs(argv, savedRepoDir)
    json = args.json
    if (args.help) {
      output.log(typecheckUsage())
      return 0
    }
    const target = resolveTypecheckTarget(args)
    const result = typecheckApp(target.appDir)
    if (args.json) {
      output.log(JSON.stringify({ ...result, branch: target.branch, worktreePath: target.worktreePath }, null, 2))
    } else {
      output.log(`[typecheck] branch=${target.branch}`)
      output.log(`[typecheck] worktree=${target.worktreePath}`)
      output.log(formatTypecheckResult(result, false))
    }
    return result.ok ? 0 : 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (json) output.log(JSON.stringify({ ok: false, error: message }, null, 2))
    else output.error(`[typecheck] ${message}\n\n${typecheckUsage()}`)
    return 1
  }
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (directEntry === import.meta.url) process.exitCode = runTypecheckCli()
