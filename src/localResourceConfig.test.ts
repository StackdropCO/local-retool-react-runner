import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { loadLocalResourceDefinitions } from './localResourceConfig.js'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'local-rest-resources-'))
  temporaryDirectories.push(directory)
  return directory
}

function writeRegistry(directory: string, resource: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'resources.json'), JSON.stringify({
    version: 1,
    resources: { 'resource-uuid': resource },
    ...extra,
  }))
}

const validSpec = `openapi: 3.0.3
info:
  title: Private upload
  version: 1.0.0
servers:
  - url: https://uploads.example.test
paths:
  /upload/v1/{token}:
    post:
      requestBody:
        content:
          application/octet-stream: {}
      responses:
        "200":
          description: Uploaded
`

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('loadLocalResourceDefinitions', () => {
  it('returns an empty map when no private registry exists', () => {
    expect(loadLocalResourceDefinitions({ directory: join(temporaryDirectory(), 'missing') })).toEqual({})
  })

  it('loads a UUID-keyed YAML policy with a stable content hash', () => {
    const directory = temporaryDirectory()
    writeRegistry(directory, {
      binding: 'privateUpload',
      spec: './upload.openapi.yaml',
      baseUrl: 'https://uploads.example.test',
    })
    writeFileSync(join(directory, 'upload.openapi.yaml'), validSpec)

    const definitions = loadLocalResourceDefinitions({
      directory,
      appResourceIds: new Set(['resource-uuid']),
    })

    const definition = definitions['resource-uuid']
    expect(definition.resourceId).toBe('resource-uuid')
    expect(definition.binding).toBe('privateUpload')
    expect(definition.baseUrl.href).toBe('https://uploads.example.test/')
    expect(definition.specHash).toBe(createHash('sha256').update(validSpec).digest('hex'))
    expect(definition.operations).toHaveLength(1)
    expect(definition.operations[0]).toMatchObject({
      method: 'POST',
      template: '/upload/v1/{token}',
      requestContentTypes: ['application/octet-stream'],
    })
    expect(definition.operations[0].pattern.test('/upload/v1/secret-token')).toBe(true)
    expect(definition.operations[0].pattern.test('/upload/v1/a/b')).toBe(false)
  })

  it('supports an allowReserved catch-all path parameter for signed upload paths', () => {
    const directory = temporaryDirectory()
    writeRegistry(directory, {
      binding: 'privateUpload',
      spec: './upload.openapi.yaml',
      baseUrl: 'https://uploads.example.test',
    })
    const spec = `openapi: 3.0.3
info: { title: Private upload, version: 1.0.0 }
servers:
  - url: https://uploads.example.test
paths:
  /{uploadPath}:
    post:
      parameters:
        - name: uploadPath
          in: path
          required: true
          allowReserved: true
          schema: { type: string }
      requestBody:
        content:
          application/octet-stream: {}
      responses:
        "200": { description: Uploaded }
`
    writeFileSync(join(directory, 'upload.openapi.yaml'), spec)

    const definition = loadLocalResourceDefinitions({ directory, appResourceIds: new Set(['resource-uuid']) })['resource-uuid']

    expect(definition.operations[0].pattern.test('/upload/v1/abc123')).toBe(true)
  })

  it.each([
    ['unknown registry fields', { extra: true }, /unknown field.*extra/i],
    ['non-HTTPS base URLs', { baseUrl: 'http://uploads.example.test' }, /https/i],
    ['server origin mismatches', { baseUrl: 'https://other.example.test' }, /server.*base URL/i],
  ])('rejects %s', (_name, override, expected) => {
    const directory = temporaryDirectory()
    writeRegistry(directory, {
      binding: 'privateUpload',
      spec: './upload.openapi.yaml',
      baseUrl: 'https://uploads.example.test',
      ...override,
    })
    writeFileSync(join(directory, 'upload.openapi.yaml'), validSpec)

    expect(() => loadLocalResourceDefinitions({
      directory,
      appResourceIds: new Set(['resource-uuid']),
    })).toThrow(expected)
  })

  it('rejects private spec paths that escape the registry directory', () => {
    const parent = temporaryDirectory()
    const directory = join(parent, 'private')
    writeRegistry(directory, {
      binding: 'privateUpload',
      spec: '../outside.openapi.yaml',
      baseUrl: 'https://uploads.example.test',
    })
    writeFileSync(join(parent, 'outside.openapi.yaml'), validSpec)

    expect(() => loadLocalResourceDefinitions({
      directory,
      appResourceIds: new Set(['resource-uuid']),
    })).toThrow(/outside.*local resource directory/i)
  })

  it('ignores shared registry UUIDs that the selected app does not reference', () => {
    const directory = temporaryDirectory()
    writeRegistry(directory, {
      binding: 'privateUpload',
      spec: './upload.openapi.yaml',
      baseUrl: 'https://uploads.example.test',
    })
    writeFileSync(join(directory, 'upload.openapi.yaml'), validSpec)

    expect(loadLocalResourceDefinitions({
      directory,
      appResourceIds: new Set(['different-uuid']),
    })).toEqual({})
  })
})
