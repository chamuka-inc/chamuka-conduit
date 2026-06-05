import type { Kysely } from 'kysely'
import type { IdempotencyStore, TenantId, IdempotencyKey } from '@conduit/contracts'
import { ExecuteResult } from '@conduit/contracts'
import type { Database } from './schema'
import { StoreError } from './errors'

const UNIQUE_VIOLATION = '23505'

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION
  )
}

/** Postgres-backed {@link IdempotencyStore}: the (tenant,key) primary key is the exactly-once guard. */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Kysely<Database>) {}

  async get(tenant: TenantId, key: IdempotencyKey): Promise<ExecuteResult | null> {
    const row = await this.db
      .selectFrom('idempotency')
      .select('result')
      .where('tenant_id', '=', tenant)
      .where('idempotency_key', '=', key)
      .executeTakeFirst()
    return row === undefined ? null : ExecuteResult.parse(row.result)
  }

  async put(tenant: TenantId, key: IdempotencyKey, result: ExecuteResult): Promise<void> {
    try {
      await this.db
        .insertInto('idempotency')
        .values({
          tenant_id: tenant,
          idempotency_key: key,
          result: JSON.stringify(result),
        })
        .execute()
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new StoreError('idempotency key already used for this tenant', { cause: error })
      }
      throw error
    }
  }
}
