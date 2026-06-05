// Identity & Tenancy (SAD §Identity & Tenancy, FR-9, NFR-SEC-1): the authority for "who is this
// caller and which credvault tenant are they", without ever accepting a tenant id from the request.
// Issuance returns the key once and persists only its hash; verification resolves a presented key
// to its principal via the hash. Backed by the store's TenantStore.

import type { TenantId, TenantPrincipal } from '@conduit/contracts'
import type { TenantStore, TenantRecord } from '@conduit/store'
import { generateApiKey, hashApiKey } from './api-key'

/** The project binding to provision: a conduit tenant mapped to a credvault tenant (FD-1). */
export interface IssueTenantInput {
  readonly tenantId: TenantId
  /** The credvault tenant this conduit project maps to. A non-secret reference, not the key. */
  readonly credvaultTenantRef: string
}

/** The result of issuance. The plaintext key is returned exactly once and never stored (NFR-SEC-1). */
export interface IssuedApiKey {
  readonly apiKey: string
  readonly principal: TenantPrincipal
}

export class IdentityService {
  readonly #tenants: TenantStore

  constructor(tenants: TenantStore) {
    this.#tenants = tenants
  }

  /** Provision a tenant: mint a key, persist only its hash, and return the key once + the principal. */
  async issue(input: IssueTenantInput): Promise<IssuedApiKey> {
    const apiKey = generateApiKey()
    const principal: TenantPrincipal = {
      tenantId: input.tenantId,
      credvaultTenantRef: input.credvaultTenantRef,
    }
    // A persisted record is the principal plus the key's hash — never the key itself (NFR-SEC-1).
    const record: TenantRecord = { ...principal, apiKeyHash: hashApiKey(apiKey) }
    await this.#tenants.insert(record)
    return { apiKey, principal }
  }

  /** Resolve a presented API key to its principal, or null if no tenant owns it (unknown/empty). */
  async verify(apiKey: string): Promise<TenantPrincipal | null> {
    const presented = apiKey.trim()
    if (presented === '') return null
    return this.#tenants.findByApiKeyHash(hashApiKey(presented))
  }
}
