// Builders for the surface tests. They assemble the same ConduitServices the production container
// wires (a real Executor + real IdentityService + the real seed catalog), but back the Executor's
// outbound ports with in-memory/stub peers so a test exercises the HTTP surface end-to-end without a
// live credvault, provider, or Postgres. A real conduit API key is issued so auth is exercised too.

import { TenantId, conduitError, err, ok } from '@conduit/contracts'
import type {
  AccessToken,
  ProviderInvoker,
  Result,
  TenantPrincipal,
  TokenResolver,
} from '@conduit/contracts'
import { Executor } from '@conduit/core'
import { loadSeedCatalog } from '@conduit/catalog'
import { IdentityService } from '@conduit/identity'
import { InMemoryAuditSink, InMemoryIdempotencyStore, InMemoryTenantStore } from '@conduit/store'

export const accessToken = (overrides: Partial<AccessToken> = {}): AccessToken => ({
  accessToken: 'gho_test_token',
  tokenType: 'Bearer',
  expiresAt: null,
  scopes: ['read:user'],
  ...overrides,
})

/** A TokenResolver that always returns the same fixed result. */
class StubResolver implements TokenResolver {
  constructor(private readonly result: Result<AccessToken>) {}
  resolve(): Promise<Result<AccessToken>> {
    return Promise.resolve(this.result)
  }
}

/** A ProviderInvoker that always returns the same fixed result. */
class StubInvoker implements ProviderInvoker {
  constructor(private readonly result: Result<unknown>) {}
  call(): Promise<Result<unknown>> {
    return Promise.resolve(this.result)
  }
}

const GITHUB_USER = { login: 'alice', id: 7, name: 'Alice', html_url: 'https://github.com/alice' }

export interface BuiltServices {
  readonly services: {
    readonly executor: Executor
    readonly identity: IdentityService
    readonly catalog: ReturnType<typeof loadSeedCatalog>
  }
  readonly apiKey: string
  readonly principal: TenantPrincipal
  readonly audit: InMemoryAuditSink
}

/** Wire a ConduitServices over in-memory peers; returns the services, a valid API key, and the sink. */
export async function buildServices(
  opts: { token?: Result<AccessToken>; provider?: Result<unknown> } = {},
): Promise<BuiltServices> {
  const catalog = loadSeedCatalog()
  const identity = new IdentityService(new InMemoryTenantStore())
  const issued = await identity.issue({
    tenantId: TenantId.parse('tenant_acme'),
    credvaultTenantRef: 'verify-acme',
  })
  const audit = new InMemoryAuditSink()
  const executor = new Executor({
    catalog,
    tokenResolver: new StubResolver(opts.token ?? ok(accessToken())),
    invoker: new StubInvoker(opts.provider ?? ok(GITHUB_USER)),
    audit,
    idempotency: new InMemoryIdempotencyStore(),
  })
  return { services: { executor, identity, catalog }, apiKey: issued.apiKey, principal: issued.principal, audit }
}

/** A TokenResolver result reporting the end-user is not connected (FR-6). */
export const notConnected = (): Result<AccessToken> =>
  err(conduitError('not_connected', 'end-user has no github connection'))

export interface OAuthConfig {
  readonly issuer: string
  readonly resource: string
  readonly signingSecret: Uint8Array
  readonly accessTokenTtlSeconds: number
}

/** OAuth config for the AS tests: a localhost issuer, the canonical MCP resource, an HS256 secret. */
export function oauthConfig(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    issuer: 'http://localhost:3000',
    // Canonical resource = conduit's origin, so discovery (RFC 9728) resolves — see getOAuthConfig.
    resource: 'http://localhost:3000',
    signingSecret: new TextEncoder().encode('conduit-test-oauth-signing-secret-0123456789'),
    accessTokenTtlSeconds: 3600,
    ...overrides,
  }
}

/** Build a JSON Request with a Bearer authorization header. */
export function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  apiKey?: string,
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`
  return new Request(url, { method, headers, body: JSON.stringify(body) })
}
