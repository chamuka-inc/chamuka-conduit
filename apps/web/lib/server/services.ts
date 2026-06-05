import type { ActionCatalog } from '@conduit/contracts'
import type { Executor } from '@conduit/core'
import type { IdentityService } from '@conduit/identity'

/**
 * The dependency surface every route handler needs. The production container builds it from env
 * (real credvault client, provider invoker, Postgres store); tests build it over in-memory peers.
 * Keeping it an injected interface is what makes the surfaces thin adapters (SAD ADR-001).
 */
export interface ConduitServices {
  readonly executor: Executor
  readonly identity: IdentityService
  readonly catalog: ActionCatalog
}
