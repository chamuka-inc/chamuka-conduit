// @conduit/store — durable persistence behind three ports: AuditSink + IdempotencyStore (frozen in
// @conduit/contracts) and TenantStore (module-local). Each has an in-memory impl (the reference
// semantics, and the backing for downstream modules' tests) and a Postgres impl + migrations (the
// durable production path). Depends only on @conduit/contracts, kysely, and pg.

export type { TenantStore, TenantRecord } from './ports'
export { InMemoryIdempotencyStore, InMemoryAuditSink, InMemoryTenantStore } from './memory'
export { PostgresIdempotencyStore } from './idempotency'
export { PostgresAuditSink } from './audit'
export { PostgresTenantStore } from './tenants'
export { createDb, CONDUIT_SCHEMA } from './db'
export type { DbHandle } from './db'
export { migrateToLatest } from './migrations'
export type { Database } from './schema'
export { StoreError } from './errors'
