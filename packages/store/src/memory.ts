// In-memory implementations of the three store ports. They are the reference semantics the
// Postgres impls must match, and they are the substitutable backing for downstream modules' tests
// (the Executor's idempotency-replay e2e in module 6, identity's verify in module 5) — so they are
// part of the package's public API, not test-only scaffolding.

import type {
  AuditSink,
  AuditEntry,
  IdempotencyStore,
  ExecuteResult,
  TenantId,
  IdempotencyKey,
  TenantPrincipal,
} from '@conduit/contracts'
import type { TenantStore, TenantRecord } from './ports'
import { StoreError } from './errors'

export class InMemoryIdempotencyStore implements IdempotencyStore {
  // Keyed tenant→key→result so the (tenant,key) composite is structural, not a fragile string
  // join (ids may contain any character, so no separator is reliably unambiguous).
  readonly #byTenant = new Map<TenantId, Map<IdempotencyKey, ExecuteResult>>()

  async get(tenant: TenantId, key: IdempotencyKey): Promise<ExecuteResult | null> {
    return this.#byTenant.get(tenant)?.get(key) ?? null
  }

  async put(tenant: TenantId, key: IdempotencyKey, result: ExecuteResult): Promise<void> {
    const keys = this.#keysFor(tenant)
    if (keys.has(key)) {
      throw new StoreError('idempotency key already used for this tenant')
    }
    keys.set(key, result)
  }

  #keysFor(tenant: TenantId): Map<IdempotencyKey, ExecuteResult> {
    const existing = this.#byTenant.get(tenant)
    if (existing !== undefined) return existing
    const created = new Map<IdempotencyKey, ExecuteResult>()
    this.#byTenant.set(tenant, created)
    return created
  }
}

export class InMemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = []

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry)
  }
}

export class InMemoryTenantStore implements TenantStore {
  readonly #byHash = new Map<string, TenantRecord>()

  async insert(record: TenantRecord): Promise<void> {
    this.#byHash.set(record.apiKeyHash, record)
  }

  async findByApiKeyHash(apiKeyHash: string): Promise<TenantPrincipal | null> {
    const record = this.#byHash.get(apiKeyHash)
    if (record === undefined) return null
    return { tenantId: record.tenantId, credvaultTenantRef: record.credvaultTenantRef }
  }
}
