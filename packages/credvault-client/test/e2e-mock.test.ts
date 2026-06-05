import { describe, it, expect } from 'vitest'
import type { TokenResolver, AccessToken, Result, TenantPrincipal, EndUserId } from '@conduit/contracts'
import { ok } from '@conduit/contracts'
import { CredvaultClient } from '../src/index'
import { principal, endUser, credentialBody, stubFetch } from './fixtures'

// E2E against a mocked peer. The credvault-client is a leaf producer; its contract consumer is the
// Executor (module 6), which acquires a token before invoking a provider. Here a minimal
// FakeExecutor touches the client ONLY through the frozen TokenResolver port, with credvault stood
// in by a stubbed FetchLike — proving the seam is sufficient before the real Executor exists.

// The consumer sees the port type, never the concrete CredvaultClient — and this annotation also
// proves CredvaultClient conforms to the frozen port.
function resolverReturning(status: number, body: unknown): TokenResolver {
  return new CredvaultClient({
    baseUrl: 'http://credvault.test',
    tenantKeyFor: () => 'cvk_tenant_secret',
    fetch: stubFetch(status, body).fetch,
  })
}

// Mock of the Executor's token-acquisition step: resolve, then either invoke the provider with the
// token or surface the failure without invoking anything.
class FakeExecutor {
  invokedWith: AccessToken | null = null

  constructor(private readonly tokens: TokenResolver) {}

  async run(
    tenant: TenantPrincipal,
    endUserId: EndUserId,
    provider: string,
  ): Promise<Result<{ calledProviderWith: AccessToken }>> {
    const resolved = await this.tokens.resolve(tenant, endUserId, provider)
    if (!resolved.ok) return resolved
    this.invokedWith = resolved.value
    return ok({ calledProviderWith: resolved.value })
  }
}

describe('Executor consumer: acquire a token through the TokenResolver port', () => {
  it('obtains a usable token for a connected end-user and invokes the provider with it', async () => {
    const executor = new FakeExecutor(resolverReturning(200, credentialBody()))
    const result = await executor.run(principal(), endUser('alice'), 'github')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.calledProviderWith.accessToken).toBe('gho_live_token')
    expect(executor.invokedWith?.tokenType).toBe('Bearer')
  })

  it('surfaces not_connected and never invokes the provider when the user has not connected', async () => {
    const executor = new FakeExecutor(
      resolverReturning(404, { code: 'not_connected', message: 'no connection' }),
    )
    const result = await executor.run(principal(), endUser('alice'), 'github')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_connected')
    expect(executor.invokedWith).toBeNull()
  })
})
