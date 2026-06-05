// Module-local seam. AuditSink and IdempotencyStore are frozen in @conduit/contracts; TenantStore
// is not — it is conduit-internal persistence consumed by @conduit/identity (module 5) to back
// API-key verification, so it lives with its producer rather than in the cross-cutting contracts.

import type { TenantId, TenantPrincipal } from '@conduit/contracts'

/** A persisted tenant row. The conduit API key is held only as its hash (NFR-SEC-1). */
export interface TenantRecord {
  readonly tenantId: TenantId
  /** The credvault tenant this conduit project maps to (FD-1). A reference, not the secret. */
  readonly credvaultTenantRef: string
  readonly apiKeyHash: string
}

/** Persistence for tenants: insert a record, and resolve a caller by their API key's hash. */
export interface TenantStore {
  insert(record: TenantRecord): Promise<void>
  /** Resolve the principal for an API-key hash, or null if no tenant owns it. */
  findByApiKeyHash(apiKeyHash: string): Promise<TenantPrincipal | null>
}
