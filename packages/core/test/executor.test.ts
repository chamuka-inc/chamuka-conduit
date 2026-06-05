import { describe, it, expect } from 'vitest'
import type { ExecuteRequest } from '@conduit/contracts'
import { TenantId, conduitError, err, ok } from '@conduit/contracts'
import { Executor } from '../src/index'
import {
  FakeIdempotencyStore,
  FakeInvoker,
  RecordingAuditSink,
  SequenceInvoker,
  action,
  endUser,
  fakeCatalog,
  idemKey,
  principal,
  resolverNotConnected,
  resolverOk,
  spec,
  token,
} from './fixtures'

// The Executor (FR-4) is the heart: it resolves the ActionSpec, validates args, brokers a token,
// renders + invokes the provider, normalizes the response into {data,raw}, records an audit entry,
// and enforces idempotency — all over injected ports, returning a Result rather than throwing. These
// specs pin its orchestration and every branch of the closed error taxonomy (FR-5) against fakes.

const request = (overrides: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
  action: action(),
  endUserId: endUser(),
  args: {},
  ...overrides,
})

/** Wire an Executor over the five port fakes, exposing each fake so a test can assert on it. */
function harness(
  options: {
    catalogSpecs?: Parameters<typeof fakeCatalog>[0]
    invoker?: FakeInvoker | SequenceInvoker
    resolver?: ReturnType<typeof resolverOk>
    now?: () => number
  } = {},
) {
  const catalog = fakeCatalog(options.catalogSpecs ?? [spec()])
  const resolver = options.resolver ?? resolverOk()
  const invoker = options.invoker ?? new FakeInvoker(ok({ login: 'alice', id: 7 }))
  const audit = new RecordingAuditSink()
  const idempotency = new FakeIdempotencyStore()
  const executor = new Executor(
    { catalog, tokenResolver: resolver, invoker, audit, idempotency },
    options.now ? { now: options.now } : {},
  )
  return { executor, resolver, invoker, audit, idempotency }
}

describe('Executor.execute — happy path', () => {
  it('resolves a token, invokes the provider, and returns a normalized {data,raw} envelope', async () => {
    const raw = { login: 'alice', id: 7, html_url: 'https://github.com/alice' }
    const { executor, invoker, resolver } = harness({ invoker: new FakeInvoker(ok(raw)) })

    const result = await executor.execute(principal(), request())

    expect(result).toEqual({
      ok: true,
      value: { data: { login: 'alice', id: 7, htmlUrl: 'https://github.com/alice' }, raw },
    })
    expect(invoker.calls).toHaveLength(1)
    expect(resolver.calls[0]).toEqual({ endUserId: endUser(), provider: 'github' })
    expect(invoker.calls[0]?.token).toEqual(token())
    expect(invoker.calls[0]?.request.url).toBe('https://api.github.com/user')
  })

  it('records a successful audit entry (FR-10) with action, end-user, tenant, outcome, and latency', async () => {
    // A clock that advances 25ms per read: startedAt reads 5025, the latency read reads 5050.
    let t = 5000
    const { executor, audit } = harness({ now: () => (t += 25) })

    await executor.execute(principal(), request())

    expect(audit.entries).toHaveLength(1)
    const entry = audit.entries[0]
    expect(entry?.action).toBe(action())
    expect(entry?.endUserId).toBe(endUser())
    expect(entry?.tenantId).toBe(principal().tenantId)
    expect(entry?.outcome).toBe('ok')
    expect(entry?.startedAt).toBe(new Date(5025).toISOString())
    expect(entry?.latencyMs).toBe(25)
  })
})

describe('Executor.execute — error taxonomy (FR-5)', () => {
  it('returns validation_error for an unknown action, touching no peer', async () => {
    const { executor, resolver, invoker } = harness()
    const result = await executor.execute(principal(), request({ action: action('github.nope') }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
    expect(resolver.calls).toHaveLength(0)
    expect(invoker.calls).toHaveLength(0)
  })

  it('returns validation_error for args that violate the input schema, before resolving a token', async () => {
    const { executor, resolver, invoker } = harness()
    const result = await executor.execute(principal(), request({ args: { surprise: 1 } }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
    expect(resolver.calls).toHaveLength(0)
    expect(invoker.calls).toHaveLength(0)
  })

  it('propagates not_connected from the token resolver without invoking the provider (FR-6)', async () => {
    const { executor, invoker } = harness({ resolver: resolverNotConnected() })
    const result = await executor.execute(principal(), request())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_connected')
    expect(invoker.calls).toHaveLength(0)
  })

  it('surfaces a render failure (template references an unprovided arg) as validation_error', async () => {
    const needsArg = spec({
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { owner: { type: 'string' }, repo: { type: 'string' } },
        additionalProperties: false,
      },
      request: { method: 'GET', urlTemplate: 'https://api.github.com/repos/{owner}/{repo}' },
      normalize: {},
    })
    const { executor, invoker } = harness({ catalogSpecs: [needsArg] })
    const result = await executor.execute(principal(), request({ args: { owner: 'octo' } }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
    expect(invoker.calls).toHaveLength(0)
  })

  it('returns internal when the normalized response violates the action outputSchema (FR-4e / FD-3)', async () => {
    // outputSchema requires an integer id; the provider hands back a string, so conduit's own
    // output contract is broken — never the caller's fault, so it must be `internal`, not provider_error.
    const strictUser = spec({
      outputSchema: {
        type: 'object',
        properties: { login: { type: 'string' }, id: { type: 'integer' } },
        required: ['login', 'id'],
      },
    })
    const invoker = new FakeInvoker(ok({ login: 'alice', id: 'not-a-number' }))
    const { executor } = harness({ catalogSpecs: [strictUser], invoker })
    const result = await executor.execute(principal(), request())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('internal')
  })

  it('propagates provider_error from the invoker (FR-5)', async () => {
    const invoker = new FakeInvoker(err(conduitError('provider_error', 'the provider returned 503')))
    const { executor } = harness({ invoker })
    const result = await executor.execute(principal(), request())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('provider_error')
  })

  it('propagates upstream_timeout from the invoker (FR-5)', async () => {
    const invoker = new FakeInvoker(
      err(conduitError('upstream_timeout', 'the provider did not respond in time')),
    )
    const { executor } = harness({ invoker })
    const result = await executor.execute(principal(), request())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('upstream_timeout')
  })

  it('records the failing outcome code in the audit entry', async () => {
    const { executor, audit } = harness({ resolver: resolverNotConnected() })
    await executor.execute(principal(), request())
    expect(audit.entries[0]?.outcome).toBe('not_connected')
  })
})

describe('Executor.execute — idempotency (FR-7, NFR-DUR-2)', () => {
  it('replays a stored result for a repeated key WITHOUT re-invoking the provider', async () => {
    const invoker = new FakeInvoker(ok({ login: 'alice', id: 7 }))
    const { executor } = harness({ invoker })
    const req = request({ idempotencyKey: idemKey() })

    const first = await executor.execute(principal(), req)
    const second = await executor.execute(principal(), req)

    expect(first).toEqual(second)
    expect(invoker.calls).toHaveLength(1)
  })

  it('scopes idempotency per tenant — a different tenant re-invokes rather than reading the cache', async () => {
    const invoker = new FakeInvoker(ok({ login: 'alice', id: 7 }))
    const { executor } = harness({ invoker })
    const req = request({ idempotencyKey: idemKey() })

    await executor.execute(principal(), req)
    await executor.execute(principal({ tenantId: TenantId.parse('tenant_other') }), req)

    expect(invoker.calls).toHaveLength(2)
  })

  it('does not cache failures — a key whose first attempt errored is retried and can then succeed', async () => {
    const invoker = new SequenceInvoker([
      err(conduitError('provider_error', 'transient 503')),
      ok({ login: 'alice', id: 7 }),
    ])
    const { executor } = harness({ invoker })
    const req = request({ idempotencyKey: idemKey() })

    const first = await executor.execute(principal(), req)
    const second = await executor.execute(principal(), req)

    expect(first.ok).toBe(false)
    expect(second.ok).toBe(true)
    expect(invoker.calls).toHaveLength(2)
  })
})
