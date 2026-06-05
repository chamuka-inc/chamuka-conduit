// Builds a Kysely instance bound to conduit's own Postgres schema. conduit shares credvault's
// database but owns a dedicated `conduit` schema; setting search_path on the pool keeps every
// query and migration scoped to it without qualifying each table name (the one place this lives).

import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { Database } from './schema'

export const CONDUIT_SCHEMA = 'conduit'

/** Owns the connection pool; callers must {@link DbHandle.destroy} it when done. */
export interface DbHandle {
  readonly db: Kysely<Database>
  destroy(): Promise<void>
}

export function createDb(connectionString: string): DbHandle {
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${CONDUIT_SCHEMA}`,
  })
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  return { db, destroy: () => db.destroy() }
}
