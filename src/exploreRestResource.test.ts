import { describe, expect, it, vi } from 'vitest'
import { createExploreRestResource, type ExploreRunner } from './exploreRestResource.js'

const entry = { resourceName: 'fleet-uuid', displayName: 'Fleet 360', binding: 'fleet360' }

describe('createExploreRestResource', () => {
  it('serializes rawRequest input safely and preserves the Retool response shape', async () => {
    const explore = vi.fn<ExploreRunner>().mockResolvedValue({
      ran: true, truncated: false, data: { data: [{ uuid: 'one' }] },
    })
    const resource = createExploreRestResource(entry, {
      checkoutDir: '/checkout', environmentName: 'staging', writes: false, endpoint: 'vehicles', explore,
    })
    const path = 'vehicle/`quoted`?filter="active"'

    await expect(resource.rawRequest({ method: 'get', path })).resolves.toEqual({ data: [{ uuid: 'one' }] })
    expect(explore).toHaveBeenCalledWith(
      `return await fleet360.rawRequest(${JSON.stringify({ method: 'GET', path })})`,
      expect.objectContaining({ rows: 5000, allowMutative: true }),
    )
  })

  it('keeps query as a compatibility alias', async () => {
    const explore = vi.fn<ExploreRunner>().mockResolvedValue({ ran: true, data: { data: { ok: true } } })
    const resource = createExploreRestResource(entry, {
      checkoutDir: '/checkout', environmentName: 'staging', writes: false, endpoint: 'vehicles', explore,
    })
    await expect(resource.query({ path: 'vehicle' })).resolves.toEqual({ data: { ok: true } })
  })

  it('blocks mutating methods before spawning unless writes are enabled', async () => {
    const explore = vi.fn<ExploreRunner>()
    const readOnly = createExploreRestResource(entry, {
      checkoutDir: '/checkout', environmentName: 'staging', writes: false, endpoint: 'vehicles', explore,
    })
    await expect(readOnly.rawRequest({ method: 'POST', path: 'vehicle', body: { secret: true } }))
      .rejects.toThrow(/write blocked.*post/i)
    expect(explore).not.toHaveBeenCalled()

    explore.mockResolvedValue({ ran: true, data: { data: { ok: true } } })
    const writable = createExploreRestResource(entry, {
      checkoutDir: '/checkout', environmentName: 'staging', writes: true, endpoint: 'vehicles', explore,
    })
    await writable.rawRequest({ method: 'POST', path: 'vehicle' })
    expect(explore).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ allowMutative: true }))
  })
})
