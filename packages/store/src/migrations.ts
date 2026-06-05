// Schema migrations, defined in code (not files) so they ship with the package and run in any
// process that has a DbHandle. migrateToLatest is the release step the live deployment runs once,
// the same way credvault applies its migrations as a release phase.

import { Migrator, sql } from 'kysely'
import type { Kysely, Migration, MigrationProvider } from 'kysely'
import { CONDUIT_SCHEMA } from './db'
import { StoreError } from './errors'
import type { Database } from './schema'

const migrations: Record<string, Migration> = {
  '001_tenants': {
    async up(db) {
      await db.schema
        .createTable('tenants')
        .addColumn('tenant_id', 'text', (col) => col.primaryKey())
        .addColumn('credvault_tenant_ref', 'text', (col) => col.notNull())
        .addColumn('api_key_hash', 'text', (col) => col.notNull().unique())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('tenants').execute()
    },
  },
  '002_idempotency': {
    async up(db) {
      await db.schema
        .createTable('idempotency')
        .addColumn('tenant_id', 'text', (col) => col.notNull())
        .addColumn('idempotency_key', 'text', (col) => col.notNull())
        .addColumn('result', 'jsonb', (col) => col.notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        // The unique (tenant, key) composite is the durable exactly-once guarantee (NFR-DUR-2).
        .addPrimaryKeyConstraint('idempotency_pkey', ['tenant_id', 'idempotency_key'])
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('idempotency').execute()
    },
  },
  '003_audit': {
    async up(db) {
      await db.schema
        .createTable('audit')
        .addColumn('id', 'bigint', (col) => col.generatedAlwaysAsIdentity().primaryKey())
        .addColumn('tenant_id', 'text', (col) => col.notNull())
        .addColumn('end_user_id', 'text', (col) => col.notNull())
        .addColumn('action', 'text', (col) => col.notNull())
        .addColumn('outcome', 'text', (col) => col.notNull())
        .addColumn('started_at', 'timestamptz', (col) => col.notNull())
        .addColumn('latency_ms', 'integer', (col) => col.notNull())
        .addColumn('recorded_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
        .execute()
    },
    async down(db) {
      await db.schema.dropTable('audit').execute()
    },
  },
}

class InCodeMigrations implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(migrations)
  }
}

/** Create conduit's schema if absent, then apply all pending migrations. Idempotent. */
export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  // The schema must exist before the migrator creates its own bookkeeping tables within it.
  await sql`create schema if not exists ${sql.id(CONDUIT_SCHEMA)}`.execute(db)
  const migrator = new Migrator({
    db,
    provider: new InCodeMigrations(),
    migrationTableSchema: CONDUIT_SCHEMA,
  })
  const { error } = await migrator.migrateToLatest()
  if (error !== undefined) {
    throw new StoreError('migration failed', { cause: error })
  }
}
