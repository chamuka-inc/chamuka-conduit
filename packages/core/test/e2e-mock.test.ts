import { describe, it, expect } from 'vitest'
import { loadSeedCatalog } from '@conduit/catalog'
import { CredvaultClient } from '@conduit/credvault-client'
import type { FetchLike as CredvaultFetch } from '@conduit/credvault-client'
import { HttpProviderInvoker } from '@conduit/provider-invoker'
import type { FetchLike as InvokerFetch } from '@conduit/provider-invoker'
import { InMemoryAuditSink, InMemoryIdempotencyStore } from '@conduit/store'
import { Executor } from '../src/index'
import { action, endUser, idemKey, principal } from './fixtures'

// E2E against mocked peers (PLAN module 6). Unlike executor.test.ts (hand-rolled port fakes), this
// wires the Executor to the *real* concrete impls of all five contract peers — the shipped seed
// ActionCatalog, store's InMemoryIdempotencyStore + InMemoryAuditSink, the real CredvaultClient
// (TokenResolver) and HttpProviderInvoker — and stubs ONLY the two outbound fetch boundaries
// (credvault and the provider). This is the gate that catches a contract violation between core and
// a real peer before live integration. It proves the happy path (FR-4), the full error taxonomy
// (FR-5), and idempotency replay without re-invoking the provider (FR-7).

/** A response in the narrow {status, json()} shape both clients consume. */
const response = (status: number, body: unknown) => ({ status, json: () => Promise.resolve(body) })

/** Stub of credvault's token-brokering API: 200 brokers a token, 404 means the user isn't connected. */
const credvaultBrokering: CredvaultFetch = () =>
  Promise.resolve(
    response(200, {
      access_token: 'gho_brokered_token',
      token_type: 'Bearer',
      expires_at: null,
      scopes: ['read:user'],
    }),
  )
const credvaultNotConnected: CredvaultFetch = () =>
  Promise.resolve(response(404, { code: 'not_connected', message: 'no connection' }))

const GITHUB_USER = { login: 'alice', id: 7, name: 'Alice', html_url: 'https://github.com/alice' }

/** Wire the Executor over the real peers; the two fetch stubs are the only mocked surface. */
function wire(opts: { credvault: CredvaultFetch; github: InvokerFetch; githubTimeoutMs?: number }) {
  const audit = new InMemoryAuditSink()
  const idempotency = new InMemoryIdempotencyStore()
  const executor = new Executor({
    catalog: loadSeedCatalog(),
    tokenResolver: new CredvaultClient({
      baseUrl: 'http://credvault.test',
      tenantKeyFor: () => 'conduit-held-tenant-key',
      fetch: opts.credvault,
    }),
    invoker: new HttpProviderInvoker({ fetch: opts.github, timeoutMs: opts.githubTimeoutMs }),
    audit,
    idempotency,
  })
  return { executor, audit, idempotency }
}

const getUser = (overrides = {}) => ({
  action: action('github.get_authenticated_user'),
  endUserId: endUser('alice'),
  args: {},
  ...overrides,
})

describe('@conduit/core e2e against real peers (stubbed fetch boundaries)', () => {
  it('brokers a token, calls the provider, and returns a normalized {data,raw} envelope (FR-4)', async () => {
    let githubCalls = 0
    const github: InvokerFetch = () => {
      githubCalls += 1
      return Promise.resolve(response(200, GITHUB_USER))
    }
    const { executor, audit } = wire({ credvault: credvaultBrokering, github })

    const result = await executor.execute(principal(), getUser())

    expect(result).toEqual({
      ok: true,
      value: {
        data: { login: 'alice', id: 7, name: 'Alice', htmlUrl: 'https://github.com/alice' },
        raw: GITHUB_USER,
      },
    })
    expect(githubCalls).toBe(1)
    expect(audit.entries[0]?.outcome).toBe('ok')
    expect(audit.entries[0]?.action).toBe(action('github.get_authenticated_user'))
  })

  it('rejects schema-invalid args as validation_error before any fetch (FR-5)', async () => {
    let touched = 0
    const counting: InvokerFetch = () => {
      touched += 1
      return Promise.resolve(response(200, GITHUB_USER))
    }
    const credvaultTouch: CredvaultFetch = () => {
      touched += 1
      return Promise.resolve(response(200, GITHUB_USER))
    }
    const { executor } = wire({ credvault: credvaultTouch, github: counting })

    // get_authenticated_user declares additionalProperties:false, so a stray arg is invalid.
    const result = await executor.execute(principal(), getUser({ args: { surprise: 1 } }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
    expect(touched).toBe(0)
  })

  it('surfaces a not-connected end-user as not_connected, without calling the provider (FR-6)', async () => {
    let githubCalls = 0
    const github: InvokerFetch = () => {
      githubCalls += 1
      return Promise.resolve(response(200, GITHUB_USER))
    }
    const { executor } = wire({ credvault: credvaultNotConnected, github })

    const result = await executor.execute(principal(), getUser())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_connected')
    expect(githubCalls).toBe(0)
  })

  it('maps a provider 5xx onto provider_error (FR-5)', async () => {
    const github: InvokerFetch = () => Promise.resolve(response(503, { message: 'down' }))
    const { executor } = wire({ credvault: credvaultBrokering, github })

    const result = await executor.execute(principal(), getUser())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('provider_error')
  })

  it('maps a provider that never responds onto upstream_timeout (FR-5)', async () => {
    const hanging: InvokerFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const { executor } = wire({ credvault: credvaultBrokering, github: hanging, githubTimeoutMs: 10 })

    const result = await executor.execute(principal(), getUser())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('upstream_timeout')
  })

  it('replays a stored result for a repeated idempotency key WITHOUT re-invoking the provider (FR-7)', async () => {
    let githubCalls = 0
    const github: InvokerFetch = () => {
      githubCalls += 1
      return Promise.resolve(response(200, GITHUB_USER))
    }
    const { executor } = wire({ credvault: credvaultBrokering, github })
    const req = getUser({ idempotencyKey: idemKey('issue-once') })

    const first = await executor.execute(principal(), req)
    const second = await executor.execute(principal(), req)

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    expect(githubCalls).toBe(1)
  })
})
