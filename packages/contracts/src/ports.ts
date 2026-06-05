// Seam interfaces (ports) between SAD components. Each is the contract a peer produces and the
// executor consumes; all are mockable so the executor's tests (Phase 6) run without live peers.

import type { Result } from './result'
import type { AccessToken } from './credvault'
import type { ExecuteResult } from './execute'
import type { ActionSpec } from './action'
import type { TenantId, EndUserId, IdempotencyKey, ActionName } from './ids'
import type { ErrorCode } from './errors'

/**
 * Lookup of actions by name (FR-1, FR-3). Produced by the Catalog; consumed by the Executor
 * (to resolve the `ActionSpec` to execute) and by the surfaces (to list tools). Added in v0.2.0
 * via `contracts/amendment-catalog-port` — the seam the Phase-5 decomposition surfaced.
 */
export interface ActionCatalog {
  get(name: ActionName): ActionSpec | undefined
  list(): readonly ActionSpec[]
}

/** Caller identity resolved at the surface; the tenant is derived server-side (NFR-SEC-1). */
export interface TenantPrincipal {
  readonly tenantId: TenantId
  /** Reference to the credvault tenant this conduit project maps to (FD-1). Not the secret. */
  readonly credvaultTenantRef: string
}

/** Resolves a valid provider token via credvault (FR-6). Produced by the Credvault Client. */
export interface TokenResolver {
  resolve(
    tenant: TenantPrincipal,
    endUserId: EndUserId,
    provider: string,
  ): Promise<Result<AccessToken>>
}

/** A request rendered from an {@link ActionSpec} + validated args, ready to send (FR-4c). */
export interface RenderedRequest {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: unknown
}

/** SSRF-safe outbound provider call (FR-4d, FR-11). Produced by the Provider Invoker. */
export interface ProviderInvoker {
  call(spec: ActionSpec, request: RenderedRequest, token: AccessToken): Promise<Result<unknown>>
}

/** A single audit record (FR-10). Carries no secrets. */
export interface AuditEntry {
  readonly tenantId: TenantId
  readonly endUserId: EndUserId
  readonly action: ActionName
  readonly outcome: ErrorCode | 'ok'
  readonly startedAt: string
  readonly latencyMs: number
}

/** Durable audit log (FR-10, NFR-DUR-1). Produced by Execution Records. */
export interface AuditSink {
  record(entry: AuditEntry): Promise<void>
}

/** Idempotency store (FR-7, NFR-DUR-2): exactly-once provider invocation per key, per tenant. */
export interface IdempotencyStore {
  get(tenant: TenantId, key: IdempotencyKey): Promise<ExecuteResult | null>
  put(tenant: TenantId, key: IdempotencyKey, result: ExecuteResult): Promise<void>
}
