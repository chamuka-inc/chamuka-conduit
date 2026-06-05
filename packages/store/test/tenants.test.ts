import { describe, it, expect } from 'vitest'
import { InMemoryTenantStore } from '../src/index'
import { tenantRecord } from './fixtures'

// The TenantStore port (NFR-SEC-1): persistence behind identity's API-key verify. A conduit key is
// stored only as its hash; lookup by that hash resolves the caller's TenantPrincipal.
describe('TenantStore (in-memory): insert + api-key-hash lookup', () => {
  it('resolves the TenantPrincipal for a known api_key_hash', async () => {
    const store = new InMemoryTenantStore()
    const record = tenantRecord({ apiKeyHash: 'sha256:abc' })
    await store.insert(record)
    expect(await store.findByApiKeyHash('sha256:abc')).toEqual({
      tenantId: record.tenantId,
      credvaultTenantRef: record.credvaultTenantRef,
    })
  })

  it('returns null for an unknown api_key_hash', async () => {
    const store = new InMemoryTenantStore()
    expect(await store.findByApiKeyHash('sha256:nope')).toBeNull()
  })

  it('does not leak the api_key_hash back through the principal', async () => {
    const store = new InMemoryTenantStore()
    await store.insert(tenantRecord({ apiKeyHash: 'sha256:secret' }))
    const principal = await store.findByApiKeyHash('sha256:secret')
    expect(principal).not.toBeNull()
    expect(Object.keys(principal ?? {})).toEqual(['tenantId', 'credvaultTenantRef'])
  })
})
