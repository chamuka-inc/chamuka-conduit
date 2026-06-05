import { existsSync, readFileSync } from 'node:fs'

/**
 * Resolved environment for conduit's live-acceptance suites.
 *
 * conduit and credvault are independent repositories, so a live run is told explicitly where
 * credvault is and which tenant key to present — nothing is assumed from a sibling directory layout.
 * The knobs:
 *
 *   CONDUIT_CREDVAULT_URL         base URL of a running credvault (e.g. http://localhost:8000)
 *   CONDUIT_CREDVAULT_TENANT_KEY  the tenant key value (as the apps/web runtime container reads it),
 *                                 OR CONDUIT_TENANT_KEY_FILE — a path to a file that holds it
 *   CONDUIT_TEST_DATABASE_URL     conduit Postgres URL for the store / identity / web suites
 *
 * Anything unset resolves to '' so callers can gate cleanly; the offline `pnpm verify` then skips the
 * live suites and stays green.
 */
export interface LiveEnv {
  /** Base URL of the running credvault, or '' if unset. */
  baseUrl: string
  /** The credvault tenant key (value or file contents), or '' if neither source is provided. */
  tenantKey: string
  /** conduit Postgres URL for the DB-backed live suites, or '' if unset. */
  databaseUrl: string
  /** A credvault URL and a tenant key are both present — the credvault-backed suites can run. */
  hasCredvault: boolean
}

/** Read the live-test environment once, applying the documented resolution order. */
export function resolveLiveEnv(): LiveEnv {
  const baseUrl = (process.env.CONDUIT_CREDVAULT_URL ?? '').trim()
  const keyFile = process.env.CONDUIT_TENANT_KEY_FILE
  const tenantKey = (
    process.env.CONDUIT_CREDVAULT_TENANT_KEY ??
    (keyFile && existsSync(keyFile) ? readFileSync(keyFile, 'utf8') : '')
  ).trim()
  const databaseUrl = (process.env.CONDUIT_TEST_DATABASE_URL ?? '').trim()
  return { baseUrl, tenantKey, databaseUrl, hasCredvault: baseUrl !== '' && tenantKey !== '' }
}
