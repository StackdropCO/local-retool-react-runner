import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type RequestListener, type Server } from 'node:http'
import { once } from 'node:events'
import type { LocalResourceDefinition } from './localResourceConfig.js'
import { createLocalRestResource } from './localRestResource.js'

const servers: Server[] = []

async function listen(handler: RequestListener): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind TCP')
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

function definition(origin: string): LocalResourceDefinition {
  return {
    resourceId: 'upload-uuid',
    binding: 'privateUpload',
    baseUrl: new URL(origin),
    specPath: '/private/upload.openapi.yaml',
    specHash: 'abc123',
    operations: [
      {
        method: 'POST',
        template: '/upload/v1/{token}',
        pattern: /^\/upload\/v1\/[^/]+$/,
        requestContentTypes: ['application/octet-stream'],
      },
      {
        method: 'GET',
        template: '/result/{kind}',
        pattern: /^\/result\/[^/]+$/,
        requestContentTypes: [],
      },
    ],
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('createLocalRestResource', () => {
  it('forwards an allowed raw upload and returns a Retool-compatible response', async () => {
    let receivedBody = Buffer.alloc(0)
    let receivedContentType = ''
    const { origin } = await listen((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        receivedBody = Buffer.concat(chunks)
        receivedContentType = String(request.headers['content-type'] ?? '')
        response.writeHead(200, { 'content-type': 'application/json', 'x-upload': 'ok' })
        response.end(JSON.stringify({ ok: true }))
      })
    })
    const resource = createLocalRestResource(definition(origin), { writes: true, endpoint: 'publish' })

    const result = await resource.query({
      method: 'POST',
      path: '/upload/v1/signed-token?x-slack-signature=hidden',
      body: Buffer.from([0, 1, 2, 255]),
    })

    expect([...receivedBody]).toEqual([0, 1, 2, 255])
    expect(receivedContentType).toBe('application/octet-stream')
    expect(result.status).toBe(200)
    expect(result.headers['x-upload']).toBe('ok')
    expect(result.data).toEqual({ ok: true })
  })

  it('normalizes non-JSON responses as text', async () => {
    const { origin } = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('uploaded')
    })
    const resource = createLocalRestResource(definition(origin), { writes: true, endpoint: 'publish' })

    await expect(resource.query({ method: 'GET', path: '/result/text' })).resolves.toMatchObject({
      status: 200,
      data: 'uploaded',
    })
  })

  it('blocks mutating methods in read-only mode before opening a connection', async () => {
    let requests = 0
    const { origin } = await listen((_request, response) => {
      requests += 1
      response.end('unexpected')
    })
    const resource = createLocalRestResource(definition(origin), { writes: false, endpoint: 'publish' })

    await expect(resource.query({ method: 'POST', path: '/upload/v1/token', body: Buffer.from('pdf') }))
      .rejects.toThrow(/write blocked.*post/i)
    expect(requests).toBe(0)
  })

  it.each([
    ['an absolute URL', 'https://evil.example/upload/v1/token', /relative root path/i],
    ['a protocol-relative URL', '//evil.example/upload/v1/token', /relative root path/i],
    ['an undocumented path', '/admin/delete?signature=do-not-print', /not allowed.*privateUpload/i],
    ['an undocumented method', '/upload/v1/token?signature=do-not-print', /not allowed.*privateUpload/i, 'DELETE'],
  ])('rejects %s without exposing signed query values', async (_name, path, expected, method = 'POST') => {
    const { origin } = await listen((_request, response) => response.end('unexpected'))
    const resource = createLocalRestResource(definition(origin), { writes: true, endpoint: 'publish' })

    let message = ''
    try {
      await resource.query({ method, path, body: Buffer.from('secret-pdf-body') })
    } catch (error) {
      message = String((error as Error).message)
    }
    expect(message).toMatch(expected)
    expect(message).not.toContain('do-not-print')
    expect(message).not.toContain('secret-pdf-body')
  })

  it('rejects redirects without following them', async () => {
    let redirectedRequests = 0
    const destination = await listen((_request, response) => {
      redirectedRequests += 1
      response.end('must not arrive')
    })
    const source = await listen((_request, response) => {
      response.writeHead(302, { location: `${destination.origin}/result/text` })
      response.end()
    })
    const resource = createLocalRestResource(definition(source.origin), { writes: true, endpoint: 'publish' })

    await expect(resource.query({ method: 'GET', path: '/result/text?signature=hidden' }))
      .rejects.toThrow(/redirect.*privateUpload/i)
    expect(redirectedRequests).toBe(0)
  })
})
