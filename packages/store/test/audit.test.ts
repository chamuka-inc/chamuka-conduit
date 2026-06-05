import { describe, it, expect } from 'vitest'
import { InMemoryAuditSink } from '../src/index'
import { auditEntry } from './fixtures'

// The AuditSink port (FR-10, NFR-DUR-1): every execution appends one durable, secret-free record.
describe('AuditSink (in-memory): durable append', () => {
  it('records entries so they can be read back in append order', async () => {
    const sink = new InMemoryAuditSink()
    const first = auditEntry({ outcome: 'ok' })
    const second = auditEntry({ outcome: 'provider_error', latencyMs: 99 })
    await sink.record(first)
    await sink.record(second)
    expect(sink.entries).toEqual([first, second])
  })

  it('carries the outcome verbatim (ok or a closed ErrorCode)', async () => {
    const sink = new InMemoryAuditSink()
    await sink.record(auditEntry({ outcome: 'upstream_timeout' }))
    expect(sink.entries[0]?.outcome).toBe('upstream_timeout')
  })
})
