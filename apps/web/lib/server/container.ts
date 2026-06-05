import 'server-only'

// The production composition root (SAD ADR-001/005): builds the one ConduitServices the route
// handlers share, from environment configuration. The Executor is wired to the real peers — the
// CredvaultClient (TokenResolver), HttpProviderInvoker, and the Postgres store — over the shipped
// seed catalog. When no database is configured it falls back to the in-memory store so the app boots
// for local dev; readiness (/readyz) reflects whether the real dependencies are configured.

import { loadSeedCatalog } from '@conduit/catalog'
import { CredvaultClient } from '@conduit/credvault-client'
import { HttpProviderInvoker } from '@conduit/provider-invoker'
import { Executor } from '@conduit/core'
import { IdentityService } from '@conduit/identity'
import type { AuditSink, IdempotencyStore } from '@conduit/contracts'
import {
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryTenantStore,
  PostgresAuditSink,
  PostgresIdempotencyStore,
  PostgresTenantStore,
  createDb,
  migrateToLatest,
} from '@conduit/store'
import type { DbHandle, TenantStore } from '@conduit/store'
import { randomBytes } from 'node:crypto'
import type { ConduitServices } from './services'
import type { OAuthConfig } from './oauth/config'
import { OAuthStore } from './oauth/store'

const DEFAULT_CREDVAULT_TENANT_REF = 'verify-acme'
const DEFAULT_PUBLIC_URL = 'http://localhost:3000'
const ACCESS_TOKEN_TTL_SECONDS = 3600

interface Backend {
  readonly services: ConduitServices
  readonly tenants: TenantStore
  readonly db: DbHandle | null
  readonly credvaultConfigured: boolean
  readonly readRecentAudit: (limit: number) => Promise<AuditRow[]>
}

/** A flattened audit record for the read-only dashboard (display strings, not domain brands). */
export interface AuditRow {
  readonly tenantId: string
  readonly endUserId: string
  readonly action: string
  readonly outcome: string
  readonly startedAt: string
  readonly latencyMs: number
}

let backend: Backend | undefined

/** Read a non-empty environment variable, or undefined. */
function env(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

interface StoreBundle {
  readonly audit: AuditSink
  readonly idempotency: IdempotencyStore
  readonly tenants: TenantStore
  readonly db: DbHandle | null
  readonly readRecentAudit: (limit: number) => Promise<AuditRow[]>
}

/** Choose the store backing: Postgres when CONDUIT_DATABASE_URL is set, else in-memory for dev. */
function buildStore(databaseUrl: string | undefined): StoreBundle {
  if (databaseUrl === undefined) {
    const audit = new InMemoryAuditSink()
    return {
      audit,
      idempotency: new InMemoryIdempotencyStore(),
      tenants: new InMemoryTenantStore(),
      db: null,
      readRecentAudit: (limit) =>
        Promise.resolve([...audit.entries].reverse().slice(0, limit).map(toAuditRow)),
    }
  }
  const db = createDb(databaseUrl)
  return {
    audit: new PostgresAuditSink(db.db),
    idempotency: new PostgresIdempotencyStore(db.db),
    tenants: new PostgresTenantStore(db.db),
    db,
    readRecentAudit: async (limit) => {
      const rows = await db.db
        .selectFrom('audit')
        .select(['tenant_id', 'end_user_id', 'action', 'outcome', 'started_at', 'latency_ms'])
        .orderBy('recorded_at', 'desc')
        .limit(limit)
        .execute()
      return rows.map((r) => ({
        tenantId: r.tenant_id,
        endUserId: r.end_user_id,
        action: r.action,
        outcome: r.outcome,
        startedAt: r.started_at.toISOString(),
        latencyMs: r.latency_ms,
      }))
    },
  }
}

function toAuditRow(entry: {
  tenantId: string
  endUserId: string
  action: string
  outcome: string
  startedAt: string
  latencyMs: number
}): AuditRow {
  const { tenantId, endUserId, action, outcome, startedAt, latencyMs } = entry
  return { tenantId, endUserId, action, outcome, startedAt, latencyMs }
}

function buildBackend(): Backend {
  const credvaultUrl = env('CONDUIT_CREDVAULT_URL')
  const tenantRef = env('CONDUIT_CREDVAULT_TENANT_REF') ?? DEFAULT_CREDVAULT_TENANT_REF
  const tenantKey = env('CONDUIT_CREDVAULT_TENANT_KEY')
  const tokenResolver = new CredvaultClient({
    baseUrl: credvaultUrl ?? '',
    tenantKeyFor: (ref) => (ref === tenantRef ? tenantKey : undefined),
  })

  const catalog = loadSeedCatalog()
  const store = buildStore(env('CONDUIT_DATABASE_URL'))
  const executor = new Executor({
    catalog,
    tokenResolver,
    invoker: new HttpProviderInvoker(),
    audit: store.audit,
    idempotency: store.idempotency,
  })
  return {
    services: { executor, identity: new IdentityService(store.tenants), catalog },
    tenants: store.tenants,
    db: store.db,
    credvaultConfigured: credvaultUrl !== undefined,
    readRecentAudit: store.readRecentAudit,
  }
}

/** The most recent audit records (FR-10) for the operator dashboard, newest first. */
export function recentAuditEntries(limit: number): Promise<AuditRow[]> {
  return getBackend().readRecentAudit(limit)
}

function getBackend(): Backend {
  if (backend === undefined) backend = buildBackend()
  return backend
}

/** The shared services for the route handlers. */
export function getServices(): ConduitServices {
  return getBackend().services
}

/** The tenant store, exposed for provisioning (issuing conduit API keys) outside the request path. */
export function getTenantStore(): TenantStore {
  return getBackend().tenants
}

/** Apply pending store migrations. Idempotent; a no-op when running on the in-memory store. */
export async function runMigrations(): Promise<void> {
  const { db } = getBackend()
  if (db !== null) await migrateToLatest(db.db)
}

let oauthConfig: OAuthConfig | undefined
let oauthStore: OAuthStore | undefined

/** The OAuth 2.1 AS configuration, derived from env. The signing secret falls back to an ephemeral
 * per-process key in dev; production sets CONDUIT_OAUTH_SIGNING_SECRET so tokens survive restarts. */
export function getOAuthConfig(): OAuthConfig {
  if (oauthConfig === undefined) {
    const publicUrl = (env('CONDUIT_PUBLIC_URL') ?? DEFAULT_PUBLIC_URL).replace(/\/+$/, '')
    const secret = env('CONDUIT_OAUTH_SIGNING_SECRET') ?? randomBytes(32).toString('base64url')
    oauthConfig = {
      issuer: publicUrl,
      // The canonical OAuth resource is conduit's origin (not the /api/mcp path): mcp-handler
      // advertises the protected-resource metadata at <resourceUrl>/.well-known/oauth-protected-resource
      // in the 401 WWW-Authenticate, and our route serves it at the origin's well-known path. Keeping
      // the resource at the origin makes the advertised discovery URL, the served metadata, the token
      // audience, and the RFC 8707 resource indicator all agree, so an MCP client's discovery resolves.
      resource: publicUrl,
      signingSecret: new TextEncoder().encode(secret),
      accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    }
  }
  return oauthConfig
}

/** The process-wide OAuth state (registered clients + outstanding auth codes). */
export function getOAuthStore(): OAuthStore {
  if (oauthStore === undefined) oauthStore = new OAuthStore()
  return oauthStore
}

/** Readiness (NFR-OPS): the broker is only useful once credvault is configured and the DB answers. */
export async function checkReady(): Promise<boolean> {
  const { credvaultConfigured, db } = getBackend()
  if (!credvaultConfigured) return false
  if (db === null) return true
  try {
    await db.db.selectNoFrom((eb) => eb.lit(1).as('ok')).execute()
    return true
  } catch {
    return false
  }
}
