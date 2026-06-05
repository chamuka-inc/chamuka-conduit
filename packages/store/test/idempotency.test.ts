import { describe, it, expect } from 'vitest'
import { InMemoryIdempotencyStore, StoreError } from '../src/index'
import { tenantId, idempotencyKey, executeResult } from './fixtures'

// The IdempotencyStore port (FR-7, NFR-DUR-2). These pin the semantics the Executor relies on for
// exactly-once provider invocation; the in-memory impl is the reference the Postgres impl must
// match at the live gate.
describe('IdempotencyStore (in-memory): exactly-once semantics', () => {
  it('get returns null for an unknown key', async () => {
    const store = new InMemoryIdempotencyStore()
    expect(await store.get(tenantId(), idempotencyKey())).toBeNull()
  })

  it('put then get round-trips the stored ExecuteResult', async () => {
    const store = new InMemoryIdempotencyStore()
    const result = executeResult()
    await store.put(tenantId(), idempotencyKey(), result)
    expect(await store.get(tenantId(), idempotencyKey())).toEqual(result)
  })

  it('rejects a second put under the same (tenant,key) — the exactly-once guard', async () => {
    const store = new InMemoryIdempotencyStore()
    await store.put(tenantId(), idempotencyKey(), executeResult())
    await expect(
      store.put(tenantId(), idempotencyKey(), executeResult()),
    ).rejects.toBeInstanceOf(StoreError)
  })

  it('isolates keys by tenant — the same key under another tenant is independent', async () => {
    const store = new InMemoryIdempotencyStore()
    const a = executeResult({ data: { id: 1 } })
    const b = executeResult({ data: { id: 2 } })
    await store.put(tenantId('acme'), idempotencyKey('k'), a)
    await store.put(tenantId('globex'), idempotencyKey('k'), b)
    expect(await store.get(tenantId('acme'), idempotencyKey('k'))).toEqual(a)
    expect(await store.get(tenantId('globex'), idempotencyKey('k'))).toEqual(b)
  })
})
