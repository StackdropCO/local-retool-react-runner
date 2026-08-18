import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'
import { createRunner, readEndpointResourceRefs, readResourceRefs } from './endpointRunner.js'

const here = dirname(fileURLToPath(import.meta.url))
const APP = process.env.RETOOL_TEST_APP || ''
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('readEndpointResourceRefs', () => {
  it('keeps resource UUIDs scoped to the endpoint files that Retool registered', () => {
    const app = mkdtempSync(join(tmpdir(), 'local-mcp-endpoint-refs-'))
    temporaryDirectories.push(app)
    mkdirSync(join(app, 'backend', 'shift'), { recursive: true })
    writeFileSync(join(app, 'package.json'), JSON.stringify({
      retool: { app: { resourceReferencesByFile: {
        '/backend/shift/read.ts': [{ name: 'read-db', displayName: 'Read DB', type: 'postgresql' }],
        '/backend/shift/write.ts': [{ name: 'write-db', displayName: 'Write DB', type: 'postgresql' }],
      } } },
    }))

    expect(readEndpointResourceRefs(app)).toEqual({
      read: [{ name: 'read-db', displayName: 'Read DB', type: 'postgresql' }],
      write: [{ name: 'write-db', displayName: 'Write DB', type: 'postgresql' }],
    })
  })
})

describe.skipIf(!APP || !existsSync(join(APP, 'package.json')))('readResourceRefs (set RETOOL_TEST_APP to run)', () => {
  it('flattens the app package.json resourceReferencesByFile to unique refs', () => {
    const refs = readResourceRefs(APP)
    expect(refs.length).toBeGreaterThan(0)
    // each ref has name (Resource id), displayName, type; no duplicate displayNames
    const displayNames = refs.map((r) => r.displayName)
    expect(new Set(displayNames).size).toBe(displayNames.length)
    for (const r of refs) {
      expect(typeof r.name).toBe('string')
      expect(typeof r.type).toBe('string')
    }
  })
})

describe('createRunner', () => {
  it('injects globals and runs a backend endpoint by file name', async () => {
    ;(globalThis as any).fakeResource = { query: async () => ({ data: [{ ok: 1 }] }) }
    const runner = createRunner({ appDir: join(here, 'fixtures'), globals: {}, user: { email: 'dev@local' } })
    const out: any = await runner.run('echoEndpoint', { a: 1 })
    expect(out.params).toEqual({ a: 1 })
    expect(out.user).toEqual({ email: 'dev@local' })
    expect(out.probe).toEqual({ data: [{ ok: 1 }] })
  })
})
