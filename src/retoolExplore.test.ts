import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runRetoolExplore, type CommandRunner } from './retoolExplore.js'

function checkout(): string {
  const directory = mkdtempSync(join(tmpdir(), 'retool-checkout-'))
  mkdirSync(join(directory, '.retool'))
  writeFileSync(join(directory, '.retool', 'app.json'), '{}')
  return directory
}

describe('runRetoolExplore', () => {
  it('passes code on stdin with an explicit environment and row cap', async () => {
    const runCommand = vi.fn<CommandRunner>().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ ran: true, data: { data: [{ ok: 1 }] }, truncated: false }),
      stderr: '',
    })

    const result = await runRetoolExplore('return await fleet360.rawRequest({"path":"vehicle"})', {
      checkoutDir: checkout(),
      environmentName: 'staging',
      rows: 4321,
      runCommand,
    })

    expect(result.data).toEqual({ data: [{ ok: 1 }] })
    expect(runCommand).toHaveBeenCalledWith('retool', [
      'resource', 'explore', '--json', '--environment', 'staging', '--rows', '4321',
    ], expect.objectContaining({
      input: 'return await fleet360.rawRequest({"path":"vehicle"})',
    }))
  })

  it('only passes the mutative capability when explicitly enabled', async () => {
    const runCommand = vi.fn<CommandRunner>().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ ran: true, data: null, truncated: false }),
      stderr: '',
    })
    await runRetoolExplore('return true', {
      checkoutDir: checkout(), environmentName: 'staging', allowMutative: true, runCommand,
    })
    expect(runCommand.mock.calls[0][1]).toContain('--allow-mutative')
  })

  it('fails closed on refusals, truncation, and invalid checkouts', async () => {
    const refused = vi.fn<CommandRunner>().mockResolvedValue({
      exitCode: 1, stdout: JSON.stringify({ ran: false, error: 'mutative' }), stderr: '',
    })
    await expect(runRetoolExplore('return true', {
      checkoutDir: checkout(), environmentName: 'staging', runCommand: refused,
    })).rejects.toThrow(/refused.*mutative/i)

    const truncated = vi.fn<CommandRunner>().mockResolvedValue({
      exitCode: 0, stdout: JSON.stringify({ ran: true, truncated: true }), stderr: '',
    })
    await expect(runRetoolExplore('return true', {
      checkoutDir: checkout(), environmentName: 'staging', runCommand: truncated,
    })).rejects.toThrow(/truncated/i)

    await expect(runRetoolExplore('return true', {
      checkoutDir: join(tmpdir(), 'not-a-retool-checkout'), environmentName: 'staging', runCommand: refused,
    })).rejects.toThrow(/\.retool\/app\.json/)
  })

  it('fails if Retool reports a different environment than requested', async () => {
    const runCommand = vi.fn<CommandRunner>().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ ran: true, environment: 'production', data: [] }),
      stderr: '',
    })
    await expect(runRetoolExplore('return true', {
      checkoutDir: checkout(), environmentName: 'staging', runCommand,
    })).rejects.toThrow(/environment mismatch.*staging.*production/i)
  })
})
