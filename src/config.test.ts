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

  it('persists the emulated current user without dropping other settings', () => {
    const currentUser = {
      id: 1, email: 'dev@example.com', firstName: 'Dev', lastName: 'User', fullName: 'Dev User',
      profilePhotoUrl: null, groups: [{ id: 2, name: 'Viewers' }], metadata: { geo: 'gbr' },
      sid: 'user_dev', externalIdentifier: null, locale: 'en',
    }
    writeConfig({ mcpUrl: 'https://a/mcp' }, file)
    writeConfig({ currentUser }, file)
    expect(readConfig(file)).toEqual({ mcpUrl: 'https://a/mcp', currentUser })
  })
})
