import type { Kysely } from 'kysely'
import type { TenantPrincipal } from '@conduit/contracts'
import { TenantId } from '@conduit/contracts'
import type { TenantStore, TenantRecord } from './ports'
import type { Database } from './schema'

/** Postgres-backed {@link TenantStore}: lookup is by api_key_hash; the principal omits the hash. */
export class PostgresTenantStore implements TenantStore {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(record: TenantRecord): Promise<void> {
    await this.db
      .insertInto('tenants')
      .values({
        tenant_id: record.tenantId,
        credvault_tenant_ref: record.credvaultTenantRef,
        api_key_hash: record.apiKeyHash,
      })
      .execute()
  }

  async findByApiKeyHash(apiKeyHash: string): Promise<TenantPrincipal | null> {
    const row = await this.db
      .selectFrom('tenants')
      .select(['tenant_id', 'credvault_tenant_ref'])
      .where('api_key_hash', '=', apiKeyHash)
      .executeTakeFirst()
    if (row === undefined) return null
    return {
      tenantId: TenantId.parse(row.tenant_id),
      credvaultTenantRef: row.credvault_tenant_ref,
    }
  }
}
