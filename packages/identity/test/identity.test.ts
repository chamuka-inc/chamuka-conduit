import { describe, it, expect } from 'vitest'
import { InMemoryTenantStore } from '@conduit/store'
import type { TenantStore } from '@conduit/store'
import { IdentityService, generateApiKey, hashApiKey, API_KEY_PREFIX } from '../src/index'
import { tenantId } from './fixtures'

// Unit specs for Identity (PLAN module 5, NFR-SEC-1). Exercised over the in-memory TenantStore.
// The tenant is always derived from the key's hash via the store — never accepted from the caller.

function service() {
  const store = new InMemoryTenantStore()
  return { store, identity: new IdentityService(store) }
}

describe('IdentityService.issue', () => {
  it('returns the plaintext key once plus the principal, and stores only the hash (NFR-SEC-1)', async () => {
    const { store, identity } = service()
    const issued = await identity.issue({ tenantId: tenantId('acme'), credvaultTenantRef: 'verify-acme' })

    expect(issued.apiKey.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(issued.principal).toEqual({ tenantId: tenantId('acme'), credvaultTenantRef: 'verify-acme' })

    // The store resolves the key's HASH to the principal; the plaintext key itself is not stored.
    expect(await store.findByApiKeyHash(hashApiKey(issued.apiKey))).toEqual(issued.principal)
    expect(await store.findByApiKeyHash(issued.apiKey)).toBeNull()
  })
})

describe('IdentityService.verify', () => {
  it('resolves a freshly issued key to its principal', async () => {
    const { identity } = service()
    const issued = await identity.issue({ tenantId: tenantId('acme'), credvaultTenantRef: 'verify-acme' })
    expect(await identity.verify(issued.apiKey)).toEqual(issued.principal)
  })

  it('returns null for a well-formed but never-issued key (NFR-SEC-1)', async () => {
    const { identity } = service()
    await identity.issue({ tenantId: tenantId('acme'), credvaultTenantRef: 'verify-acme' })
    expect(await identity.verify(generateApiKey())).toBeNull()
  })

  it('returns null for an empty or whitespace key without consulting the store', async () => {
    const lookups: string[] = []
    const store: TenantStore = {
      insert: () => Promise.resolve(),
      findByApiKeyHash: (hash) => {
        lookups.push(hash)
        return Promise.resolve(null)
      },
    }
    const identity = new IdentityService(store)
    expect(await identity.verify('')).toBeNull()
    expect(await identity.verify('   ')).toBeNull()
    expect(lookups).toHaveLength(0)
  })

  it('isolates tenants: each key resolves only to its own principal', async () => {
    const { identity } = service()
    const a = await identity.issue({ tenantId: tenantId('acme'), credvaultTenantRef: 'cv-acme' })
    const b = await identity.issue({ tenantId: tenantId('globex'), credvaultTenantRef: 'cv-globex' })

    expect(a.apiKey).not.toBe(b.apiKey)
    expect(await identity.verify(a.apiKey)).toEqual(a.principal)
    expect(await identity.verify(b.apiKey)).toEqual(b.principal)
  })
})
