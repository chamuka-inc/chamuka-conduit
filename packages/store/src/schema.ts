// The database shape Kysely type-checks queries against. One table per port:
// tenants (TenantStore), idempotency (IdempotencyStore), audit (AuditSink). All live in conduit's
// own Postgres schema (see db.ts), never touching credvault's tables in the shared database.

import type { ColumnType, Generated } from 'kysely'
import type { ExecuteResult } from '@conduit/contracts'

interface TenantsTable {
  tenant_id: string
  credvault_tenant_ref: string
  api_key_hash: string
  created_at: Generated<Date>
}

interface IdempotencyTable {
  tenant_id: string
  idempotency_key: string
  // jsonb: read back as the parsed envelope, written as a JSON string.
  result: ColumnType<ExecuteResult, string, string>
  created_at: Generated<Date>
}

interface AuditTable {
  id: Generated<number>
  tenant_id: string
  end_user_id: string
  action: string
  outcome: string
  started_at: ColumnType<Date, string, string>
  latency_ms: number
  recorded_at: Generated<Date>
}

export interface Database {
  tenants: TenantsTable
  idempotency: IdempotencyTable
  audit: AuditTable
}
