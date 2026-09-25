import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type RetoolExplorePayload = {
  ran: boolean
  environment?: string
  classification?: string
  resources?: unknown
  data?: unknown
  truncated?: boolean
  error?: unknown
  reason?: unknown
  mutativeCause?: unknown
}

export type RetoolExploreOptions = {
  checkoutDir: string
  environmentName: string
  rows?: number
  allowMutative?: boolean
  command?: string
  runCommand?: CommandRunner
}

export type CommandResult = { exitCode: number | null; stdout: string; stderr: string }
export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; input: string },
) => Promise<CommandResult>

export function validateRetoolCheckout(checkoutDir: string): void {
  if (!checkoutDir) throw new Error('A Retool CLI checkout is required for resource explore')
  if (!existsSync(join(checkoutDir, '.retool', 'app.json'))) {
    throw new Error(
      `Retool CLI checkout is invalid: ${checkoutDir} has no .retool/app.json. ` +
      'Use `retool clone <app> <dir> --branch <existing-branch>` first.',
    )
  }
}

export const runCommand: CommandRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      reject(new Error(`Retool CLI executable not found: ${command}`))
    } else {
      reject(error)
    }
  })
  child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  child.stdin.end(options.input)
})

export async function runRetoolExplore(code: string, options: RetoolExploreOptions): Promise<RetoolExplorePayload> {
  validateRetoolCheckout(options.checkoutDir)
  if (!options.environmentName.trim()) throw new Error('Retool environment is required for resource explore')
  const rows = options.rows ?? 5000
  if (!Number.isSafeInteger(rows) || rows < 1) throw new Error('Retool explore row limit must be a positive integer')

  const args = [
    'resource', 'explore',
    '--json',
    '--environment', options.environmentName,
    '--rows', String(rows),
  ]
  if (options.allowMutative) args.push('--allow-mutative')

  const result = await (options.runCommand ?? runCommand)(options.command ?? 'retool', args, {
    cwd: options.checkoutDir,
    input: code,
  })
  const output = result.stdout.trim()
  if (!output) {
    throw new Error(result.stderr.trim() || `retool resource explore exited with code ${result.exitCode}`)
  }

  let payload: RetoolExplorePayload
  try {
    payload = JSON.parse(output) as RetoolExplorePayload
  } catch {
    throw new Error('retool resource explore returned invalid JSON')
  }
  if (!payload.ran) {
    const explanation = typeof payload.error === 'string'
      ? payload.error
      : typeof payload.reason === 'string' ? payload.reason : ''
    const detail = explanation ? `: ${explanation}` : ''
    throw new Error(`Retool refused to run resource explore${detail}`)
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `retool resource explore exited with code ${result.exitCode}`)
  }
  if (payload.environment && payload.environment !== options.environmentName) {
    throw new Error(
      `Retool resource explore environment mismatch: requested ${options.environmentName}, ` +
      `received ${payload.environment}`,
    )
  }
  if (payload.truncated) {
    throw new Error(`Retool resource explore truncated the result at ${rows} rows`)
  }
  return payload
}
