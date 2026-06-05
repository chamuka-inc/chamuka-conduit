import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import {
  createDb,
  migrateToLatest,
  PostgresIdempotencyStore,
  PostgresAuditSink,
  PostgresTenantStore,
  StoreError,
} from '../src/index'
import type { DbHandle } from '../src/index'
import { resolveLiveEnv } from '@conduit/test-support'
import {
  tenantId,
  idempotencyKey,
  actionName,
  executeResult,
  auditEntry,
  tenantRecord,
} from './fixtures'

// Live acceptance (PLAN module 2). The store's only real peer is Postgres, so this is its final
// gate. Gated on CONDUIT_TEST_DATABASE_URL: run it against the credvault Postgres
//   CONDUIT_TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault pnpm test
// otherwise it skips so the DB-less verify stays green. conduit owns the `conduit` schema, fully
// isolated from credvault's tables in the same database.
const { databaseUrl } = resolveLiveEnv()
const live = databaseUrl === '' ? describe.skip : describe

live('@conduit/store live acceptance against real Postgres', () => {
  let handle: DbHandle

  beforeAll(async () => {
    handle = createDb(databaseUrl)
    await migrateToLatest(handle.db)
    // Repeatable runs: start from an empty schema each time.
    await sql`truncate table idempotency, audit, tenants`.execute(handle.db)
  })

  afterAll(async () => {
    await handle.destroy()
  })

  it('idempotency put/get round-trips and the unique (tenant,key) constraint enforces exactly-once (NFR-DUR-2)', async () => {
    const store = new PostgresIdempotencyStore(handle.db)
    const tenant = tenantId('acme-live')
    const key = idempotencyKey('idem-live-1')

    expect(await store.get(tenant, key)).toBeNull()

    const result = executeResult({ data: { login: 'alice' } })
    await store.put(tenant, key, result)
    expect(await store.get(tenant, key)).toEqual(result)

    // The unique (tenant_id, idempotency_key) constraint is the durable exactly-once guard.
    await expect(store.put(tenant, key, executeResult())).rejects.toBeInstanceOf(StoreError)
  })

  it('audit append persists a durable, secret-free record (NFR-DUR-1, FR-10)', async () => {
    const sink = new PostgresAuditSink(handle.db)
    const entry = auditEntry({
      tenantId: tenantId('acme-live'),
      action: actionName('github.get_authenticated_user'),
      outcome: 'ok',
      latencyMs: 137,
    })
    await sink.record(entry)

    const rows = await handle.db
      .selectFrom('audit')
      .selectAll()
      .where('tenant_id', '=', entry.tenantId)
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.outcome).toBe('ok')
    expect(rows[0]?.action).toBe('github.get_authenticated_user')
    expect(rows[0]?.latency_ms).toBe(137)
  })

  it('tenant insert + api_key_hash lookup resolves the principal (NFR-SEC-1)', async () => {
    const store = new PostgresTenantStore(handle.db)
    const record = tenantRecord({
      tenantId: tenantId('acme-live'),
      credvaultTenantRef: 'verify-acme',
      apiKeyHash: 'sha256:live-abc',
    })
    await store.insert(record)

    expect(await store.findByApiKeyHash('sha256:live-abc')).toEqual({
      tenantId: record.tenantId,
      credvaultTenantRef: record.credvaultTenantRef,
    })
    expect(await store.findByApiKeyHash('sha256:absent')).toBeNull()
  })

  it('migrateToLatest is idempotent — re-running against an up-to-date schema is a no-op', async () => {
    await expect(migrateToLatest(handle.db)).resolves.toBeUndefined()
  })
})
