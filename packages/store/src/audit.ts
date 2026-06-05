import type { Kysely } from 'kysely'
import type { AuditSink, AuditEntry } from '@conduit/contracts'
import type { Database } from './schema'

/** Postgres-backed {@link AuditSink}: one append-only row per execution (FR-10, NFR-DUR-1). */
export class PostgresAuditSink implements AuditSink {
  constructor(private readonly db: Kysely<Database>) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db
      .insertInto('audit')
      .values({
        tenant_id: entry.tenantId,
        end_user_id: entry.endUserId,
        action: entry.action,
        outcome: entry.outcome,
        started_at: entry.startedAt,
        latency_ms: entry.latencyMs,
      })
      .execute()
  }
}
