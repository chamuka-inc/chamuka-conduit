import { describe, it, expect } from 'vitest'
import { CredvaultClient } from '../src/index'
import {
  principal,
  endUser,
  credentialBody,
  stubFetch,
  hangingFetch,
  failingFetch,
} from './fixtures'

// Unit specs for the TokenResolver impl (FR-6). The peer is credvault's HTTP API, stood in for by
// an injected FetchLike, so every response→Result mapping is pinned here before the live gate.
// resolve() never throws across the port — failures are err(ConduitError).

const KEY = 'cvk_tenant_secret'
const keyFor = (ref: string) => (ref === 'verify-acme' ? KEY : undefined)

function clientReturning(status: number, body: unknown) {
  const stub = stubFetch(status, body)
  const client = new CredvaultClient({
    baseUrl: 'http://credvault.test',
    tenantKeyFor: keyFor,
    fetch: stub.fetch,
  })
  return { client, calls: stub.calls }
}

describe('CredvaultClient.resolve', () => {
  it('resolves a connected end-user to an AccessToken and authenticates the request', async () => {
    const { client, calls } = clientReturning(200, credentialBody())
    const result = await client.resolve(principal(), endUser('alice'), 'github')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        accessToken: 'gho_live_token',
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: ['repo', 'read:user'],
      })
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]?.authorization).toBe(`Bearer ${KEY}`)
    expect(calls[0]?.url).toBe(
      'http://credvault.test/v1/credentials/github?external_user_id=alice',
    )
  })

  it('maps a 404 not_connected to a not_connected ConduitError (FR-6)', async () => {
    const { client } = clientReturning(404, {
      code: 'not_connected',
      message: 'no connection for this tenant/provider/user',
    })
    const result = await client.resolve(principal(), endUser('alice'), 'github')
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'not_connected' }) })
  })

  it('maps a 404 unknown_provider to a validation_error (a bad provider argument)', async () => {
    const { client } = clientReturning(404, { code: 'unknown_provider', message: 'no such provider' })
    const result = await client.resolve(principal(), endUser('alice'), 'nope')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
  })

  it('fails internal without calling credvault when no tenant key is configured', async () => {
    const stub = stubFetch(200, credentialBody())
    const client = new CredvaultClient({
      baseUrl: 'http://credvault.test',
      tenantKeyFor: () => undefined,
      fetch: stub.fetch,
    })
    const result = await client.resolve(principal('unmapped'), endUser('alice'), 'github')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('internal')
    expect(stub.calls).toHaveLength(0)
  })

  it('maps a slow credvault to upstream_timeout', async () => {
    const client = new CredvaultClient({
      baseUrl: 'http://credvault.test',
      tenantKeyFor: keyFor,
      fetch: hangingFetch,
      timeoutMs: 5,
    })
    const result = await client.resolve(principal(), endUser('alice'), 'github')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('upstream_timeout')
  })

  it('maps a transport failure to internal', async () => {
    const client = new CredvaultClient({
      baseUrl: 'http://credvault.test',
      tenantKeyFor: keyFor,
      fetch: failingFetch,
    })
    const result = await client.resolve(principal(), endUser('alice'), 'github')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('internal')
  })

  it('maps a 502/503 from credvault to provider_error', async () => {
    const { client } = clientReturning(503, { code: 'refresh_failed', message: 'try later' })
    const result = await client.resolve(principal(), endUser('alice'), 'github')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('provider_error')
  })

  it('treats a malformed 200 body as internal (credvault broke the contract)', async () => {
    const { client } = clientReturning(200, { access_token: 123, token_type: 'Bearer' })
    const result = await client.resolve(principal(), endUser('alice'), 'github')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('internal')
  })
})
