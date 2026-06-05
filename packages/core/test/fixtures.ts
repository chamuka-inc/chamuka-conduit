// Shared builders and in-memory port fakes for the Executor tests. The Executor consumes its peers
// ONLY through the frozen ports (ActionCatalog, TokenResolver, ProviderInvoker, AuditSink,
// IdempotencyStore), so these fakes are the entire seam its unit/e2e-mock suites exercise — no live
// peer is touched. Each fake records what it was asked to do so a test can assert call counts
// (e.g. idempotency replay must NOT re-invoke the provider).

import { ActionName, EndUserId, IdempotencyKey, TenantId } from '@conduit/contracts'
import type {
  AccessToken,
  ActionCatalog,
  ActionSpec,
  AuditEntry,
  AuditSink,
  ExecuteResult,
  IdempotencyStore,
  ProviderInvoker,
  RenderedRequest,
  Result,
  TenantPrincipal,
  TokenResolver,
} from '@conduit/contracts'
import { conduitError, err, ok } from '@conduit/contracts'

/** A complete ActionSpec, defaulted to github.get_authenticated_user; override any field. */
export function spec(overrides: Partial<ActionSpec> = {}): ActionSpec {
  return {
    name: ActionName.parse('github.get_authenticated_user'),
    provider: 'github',
    description: 'Get the authenticated user',
    providerHosts: ['api.github.com'],
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
    request: {
      method: 'GET',
      urlTemplate: 'https://api.github.com/user',
      headers: { accept: 'application/vnd.github+json' },
    },
    normalize: { login: 'login', id: 'id', htmlUrl: 'html_url' },
    ...overrides,
  }
}

export const principal = (overrides: Partial<TenantPrincipal> = {}): TenantPrincipal => ({
  tenantId: TenantId.parse('tenant_acme'),
  credvaultTenantRef: 'verify-acme',
  ...overrides,
})

export const token = (overrides: Partial<AccessToken> = {}): AccessToken => ({
  accessToken: 'gho_live_token',
  tokenType: 'Bearer',
  expiresAt: null,
  scopes: ['read:user'],
  ...overrides,
})

export const endUser = (id = 'alice'): EndUserId => EndUserId.parse(id)
export const action = (name = 'github.get_authenticated_user'): ActionName => ActionName.parse(name)
export const idemKey = (key = 'idem-1'): IdempotencyKey => IdempotencyKey.parse(key)

/** name→spec index over a fixed set of specs; the InMemoryCatalog's behaviour without the loader. */
export function fakeCatalog(specs: readonly ActionSpec[]): ActionCatalog {
  const byName = new Map(specs.map((s) => [s.name, s]))
  return {
    get: (name) => byName.get(name),
    list: () => [...byName.values()],
  }
}

/** A TokenResolver returning a fixed result; records every (endUserId, provider) it was asked for. */
export class FakeTokenResolver implements TokenResolver {
  readonly calls: { endUserId: EndUserId; provider: string }[] = []
  constructor(private readonly result: Result<AccessToken>) {}
  resolve(_t: TenantPrincipal, endUserId: EndUserId, provider: string): Promise<Result<AccessToken>> {
    this.calls.push({ endUserId, provider })
    return Promise.resolve(this.result)
  }
}

/** A ProviderInvoker returning a fixed result; records each rendered request + token it was handed. */
export class FakeInvoker implements ProviderInvoker {
  readonly calls: { request: RenderedRequest; token: AccessToken }[] = []
  constructor(private readonly result: Result<unknown>) {}
  call(_spec: ActionSpec, request: RenderedRequest, t: AccessToken): Promise<Result<unknown>> {
    this.calls.push({ request, token: t })
    return Promise.resolve(this.result)
  }
}

/** A ProviderInvoker that returns a scripted sequence of results (the last repeats), recording each
 * call — used to prove a key whose first attempt failed is retried rather than served from cache. */
export class SequenceInvoker implements ProviderInvoker {
  readonly calls: { request: RenderedRequest; token: AccessToken }[] = []
  #index = 0
  constructor(private readonly results: readonly Result<unknown>[]) {}
  call(_spec: ActionSpec, request: RenderedRequest, t: AccessToken): Promise<Result<unknown>> {
    this.calls.push({ request, token: t })
    const at = Math.min(this.#index, this.results.length - 1)
    this.#index += 1
    return Promise.resolve(this.results[at] ?? ok(null))
  }
}

/** An AuditSink that collects every entry it records. */
export class RecordingAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = []
  record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry)
    return Promise.resolve()
  }
}

/** A Map-backed IdempotencyStore with exactly-once get/put semantics. Keyed tenant→key→result so the
 * (tenant,key) composite is structural, not a fragile string join — ids may contain any character, so
 * no separator is reliably unambiguous (the same reasoning the real InMemoryIdempotencyStore documents). */
export class FakeIdempotencyStore implements IdempotencyStore {
  readonly #byTenant = new Map<TenantId, Map<IdempotencyKey, ExecuteResult>>()
  get(tenant: TenantId, key: IdempotencyKey): Promise<ExecuteResult | null> {
    return Promise.resolve(this.#byTenant.get(tenant)?.get(key) ?? null)
  }
  put(tenant: TenantId, key: IdempotencyKey, result: ExecuteResult): Promise<void> {
    const keys = this.#byTenant.get(tenant) ?? new Map<IdempotencyKey, ExecuteResult>()
    keys.set(key, result)
    this.#byTenant.set(tenant, keys)
    return Promise.resolve()
  }
}

/** A token resolver that resolves successfully — the common happy-path peer. */
export const resolverOk = (t: AccessToken = token()): FakeTokenResolver =>
  new FakeTokenResolver(ok(t))

/** A token resolver that reports the end-user is not connected (FR-6). */
export const resolverNotConnected = (): FakeTokenResolver =>
  new FakeTokenResolver(err(conduitError('not_connected', 'end-user has no github connection')))
