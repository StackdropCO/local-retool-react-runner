import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLocalResourceSpec, saveLocalResourceSpec } from './localResourceSpecStore.js'

const temporaryDirectories: string[] = []

const validSpec = `openapi: 3.0.3
info: { title: Upload, version: 1.0.0 }
servers:
  - url: https://uploads.example.test
paths:
  /upload:
    post:
      responses:
        "200": { description: Uploaded }
`

function fixture(): { directory: string; specPath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'local-spec-editor-'))
  temporaryDirectories.push(directory)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'resources.json'), JSON.stringify({
    version: 1,
    resources: {
      'resource-uuid': {
        binding: 'privateUpload',
        spec: './upload.openapi.yaml',
        baseUrl: 'https://uploads.example.test',
      },
    },
  }))
  const specPath = join(directory, 'upload.openapi.yaml')
  writeFileSync(specPath, validSpec)
  return { directory, specPath }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('local resource spec store', () => {
  it('reads a configured spec by resource UUID', () => {
    const { directory } = fixture()

    const result = readLocalResourceSpec('resource-uuid', { directory })

    expect(result).toMatchObject({
      resourceId: 'resource-uuid',
      binding: 'privateUpload',
      specFile: 'upload.openapi.yaml',
      content: validSpec,
    })
    expect(result.specHash).toMatch(/^[a-f0-9]{12}$/)
  })

  it('validates and atomically saves a configured spec', () => {
    const { directory, specPath } = fixture()
    const updated = validSpec.replace('title: Upload', 'title: Updated upload')

    const result = saveLocalResourceSpec('resource-uuid', updated, { directory })

    expect(readFileSync(specPath, 'utf8')).toBe(updated)
    expect(result.content).toBe(updated)
    expect(result.specHash).toBe(createHash('sha256').update(updated).digest('hex').slice(0, 12))
  })

  it('leaves the original file untouched when candidate validation fails', () => {
    const { directory, specPath } = fixture()

    expect(() => saveLocalResourceSpec('resource-uuid', 'openapi: [', { directory })).toThrow(/parse/i)
    expect(readFileSync(specPath, 'utf8')).toBe(validSpec)
  })

  it('rejects an unknown UUID instead of accepting a path', () => {
    const { directory } = fixture()

    expect(() => readLocalResourceSpec('../upload.openapi.yaml', { directory })).toThrow(/not configured/i)
  })
})
