import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createDb, migrateToLatest, PostgresTenantStore } from '@conduit/store'
import type { DbHandle } from '@conduit/store'
import { TenantId } from '@conduit/contracts'
import { IdentityService, generateApiKey, API_KEY_PREFIX } from '../src/index'

// Live acceptance (PLAN module 5, NFR-SEC-1) against real Postgres — Identity over the durable
// PostgresTenantStore. Gated on CONDUIT_TEST_DATABASE_URL:
//   CONDUIT_TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault pnpm test
// otherwise it skips so the DB-less verify stays green. conduit owns the `conduit` schema.
const url = process.env.CONDUIT_TEST_DATABASE_URL ?? ''
const live = url === '' ? describe.skip : describe

live('@conduit/identity live acceptance against real Postgres', () => {
  let handle: DbHandle

  beforeAll(async () => {
    handle = createDb(url)
    await migrateToLatest(handle.db)
    // Repeatable runs: start from an empty tenants table each time.
    await handle.db.deleteFrom('tenants').execute()
  })

  afterAll(async () => {
    await handle.destroy()
  })

  it('issues a key for a project, verify resolves the principal, unknown key -> null (NFR-SEC-1)', async () => {
    const identity = new IdentityService(new PostgresTenantStore(handle.db))
    const issued = await identity.issue({
      tenantId: TenantId.parse('acme-identity-live'),
      credvaultTenantRef: 'verify-acme',
    })

    expect(issued.apiKey.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(await identity.verify(issued.apiKey)).toEqual(issued.principal)
    expect(await identity.verify(generateApiKey())).toBeNull()

    // Durable posture: only the hash is persisted; the plaintext key never touches the table.
    const rows = await handle.db.selectFrom('tenants').select(['api_key_hash']).execute()
    expect(rows.some((r) => r.api_key_hash === issued.apiKey)).toBe(false)
    expect(rows.length).toBeGreaterThan(0)
  })
})
