import { describe, it, expect } from 'vitest'
import type { IdempotencyStore, AuditSink, ExecuteResult } from '@conduit/contracts'
import { conduitError } from '@conduit/contracts'
import {
  InMemoryIdempotencyStore,
  InMemoryAuditSink,
  InMemoryTenantStore,
  StoreError,
} from '../src/index'
import type { TenantStore } from '../src/index'
import {
  tenantId,
  endUserId,
  idempotencyKey,
  actionName,
  executeResult,
  tenantRecord,
} from './fixtures'

// E2E against mocked peers. The store is a leaf producer; its contract peers are its consumers —
// the Executor (module 6, via IdempotencyStore + AuditSink) and identity (module 5, via
// TenantStore). Here each consumer is a minimal mock that touches the store ONLY through its
// ports, proving the seam is sufficient before the real consumers are built.

// A provider call: returns the raw result, or throws to simulate a provider failure.
type Provider = () => Promise<ExecuteResult>

// Mock of the Executor's idempotency-guarded step (FR-4, FR-7, FR-10): replay-or-invoke, then
// always audit. It reaches the store only through the two frozen ports.
class FakeExecutor {
  invocations = 0

  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditSink,
  ) {}

  async execute(args: {
    readonly tenant: ReturnType<typeof tenantId>
    readonly endUser: ReturnType<typeof endUserId>
    readonly action: ReturnType<typeof actionName>
    readonly key?: ReturnType<typeof idempotencyKey>
    readonly provider: Provider
  }): Promise<ExecuteResult> {
    const { tenant, endUser, action, key, provider } = args
    if (key !== undefined) {
      const replay = await this.idempotency.get(tenant, key)
      if (replay !== null) return replay
    }
    this.invocations += 1
    try {
      const result = await provider()
      if (key !== undefined) await this.idempotency.put(tenant, key, result)
      await this.audit.record({
        tenantId: tenant,
        endUserId: endUser,
        action,
        outcome: 'ok',
        startedAt: '2026-06-04T12:00:00.000Z',
        latencyMs: 12,
      })
      return result
    } catch {
      await this.audit.record({
        tenantId: tenant,
        endUserId: endUser,
        action,
        outcome: 'provider_error',
        startedAt: '2026-06-04T12:00:00.000Z',
        latencyMs: 7,
      })
      throw conduitError('provider_error', 'provider call failed')
    }
  }
}

describe('Executor consumer: idempotency replay + audit through the store ports', () => {
  const base = {
    tenant: tenantId(),
    endUser: endUserId(),
    action: actionName(),
  }

  it('replays a repeated idempotency key without re-invoking the provider (FR-7)', async () => {
    const idempotency = new InMemoryIdempotencyStore()
    const audit = new InMemoryAuditSink()
    const executor = new FakeExecutor(idempotency, audit)
    const key = idempotencyKey()
    const provider: Provider = () => Promise.resolve(executeResult({ data: { id: 7 } }))

    const first = await executor.execute({ ...base, key, provider })
    const second = await executor.execute({ ...base, key, provider })

    expect(second).toEqual(first)
    expect(executor.invocations).toBe(1)
    expect(audit.entries).toHaveLength(1)
  })

  it('does not dedup when no idempotency key is supplied', async () => {
    const executor = new FakeExecutor(new InMemoryIdempotencyStore(), new InMemoryAuditSink())
    const provider: Provider = () => Promise.resolve(executeResult())
    await executor.execute({ ...base, provider })
    await executor.execute({ ...base, provider })
    expect(executor.invocations).toBe(2)
  })

  it('audits a failed execution as provider_error and leaves the key free to retry', async () => {
    const idempotency = new InMemoryIdempotencyStore()
    const audit = new InMemoryAuditSink()
    const executor = new FakeExecutor(idempotency, audit)
    const key = idempotencyKey()
    const failing: Provider = () => Promise.reject(new Error('502'))

    await expect(executor.execute({ ...base, key, provider: failing })).rejects.toMatchObject({
      code: 'provider_error',
    })
    expect(audit.entries.map((e) => e.outcome)).toEqual(['provider_error'])
    // A failed execution never occupied the key, so a retry can still take it.
    expect(await idempotency.get(base.tenant, key)).toBeNull()
  })

  it('exactly-once: when two executions race past the get-miss, the store rejects the loser', async () => {
    const idempotency = new InMemoryIdempotencyStore()
    const tenant = tenantId()
    const key = idempotencyKey()
    // Both executions observed a miss before either committed.
    expect(await idempotency.get(tenant, key)).toBeNull()
    const winner = executeResult({ data: { winner: true } })
    await idempotency.put(tenant, key, winner)
    // The loser's commit is rejected; its recovery is to replay the winner's stored result.
    await expect(
      idempotency.put(tenant, key, executeResult({ data: { winner: false } })),
    ).rejects.toBeInstanceOf(StoreError)
    expect(await idempotency.get(tenant, key)).toEqual(winner)
  })
})

describe('Identity consumer: API-key verify through the TenantStore port (NFR-SEC-1)', () => {
  // Mock of identity's issue/verify (module 5): issue stores the key's hash; verify hashes the
  // presented key and resolves the principal. The store sees only hashes, never raw keys.
  const hashOf = (apiKey: string) => `sha256:${apiKey}`

  function makeIdentity(store: TenantStore) {
    return {
      issue: (record: ReturnType<typeof tenantRecord>) => store.insert(record),
      verify: (apiKey: string) => store.findByApiKeyHash(hashOf(apiKey)),
    }
  }

  it('verifies an issued key to its TenantPrincipal and rejects an unknown key', async () => {
    const store = new InMemoryTenantStore()
    const identity = makeIdentity(store)
    const record = tenantRecord({ apiKeyHash: hashOf('live-key') })
    await identity.issue(record)

    expect(await identity.verify('live-key')).toEqual({
      tenantId: record.tenantId,
      credvaultTenantRef: record.credvaultTenantRef,
    })
    expect(await identity.verify('forged-key')).toBeNull()
  })
})
