import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig } from './config.js'

describe('config', () => {
  let file: string
  beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'config.json') })

  it('returns {} when missing and merges on write', () => {
    expect(readConfig(file)).toEqual({})
    writeConfig({ mcpUrl: 'https://a/mcp' }, file)
    writeConfig({ repoDir: '/repo' }, file)
    expect(readConfig(file)).toEqual({ mcpUrl: 'https://a/mcp', repoDir: '/repo' })
  })
})
