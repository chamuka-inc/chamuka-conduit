// Shared builders for the store's tests. Branded ids are parsed through the frozen contracts so
// the fixtures exercise the same validation the real callers do (no bare-string shortcuts).

import { TenantId, EndUserId, IdempotencyKey, ActionName, ExecuteResult } from '@conduit/contracts'
import type { AuditEntry } from '@conduit/contracts'
import type { TenantRecord } from '../src/index'

export const tenantId = (s = 'acme') => TenantId.parse(s)
export const endUserId = (s = 'alice') => EndUserId.parse(s)
export const idempotencyKey = (s = 'idem-001') => IdempotencyKey.parse(s)
export const actionName = (s = 'github.create_issue') => ActionName.parse(s)

export const executeResult = (overrides: Record<string, unknown> = {}): ExecuteResult =>
  ExecuteResult.parse({ data: { id: 1 }, raw: { id: 1, node_id: 'MDQ6' }, ...overrides })

export const auditEntry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  tenantId: tenantId(),
  endUserId: endUserId(),
  action: actionName(),
  outcome: 'ok',
  startedAt: '2026-06-04T12:00:00.000Z',
  latencyMs: 42,
  ...overrides,
})

export const tenantRecord = (overrides: Partial<TenantRecord> = {}): TenantRecord => ({
  tenantId: tenantId(),
  credvaultTenantRef: 'verify-acme',
  apiKeyHash: 'sha256:deadbeef',
  ...overrides,
})
