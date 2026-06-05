// The Executor (FR-4) — conduit's heart. For one (principal, ExecuteRequest) it: resolves the
// ActionSpec from the catalog, validates args against its inputSchema, enforces idempotency, brokers
// a provider token, renders + invokes the request, normalizes the response into the {data,raw}
// envelope, and records an audit entry. It consumes its peers only through the frozen ports
// (ActionCatalog, TokenResolver, ProviderInvoker, AuditSink, IdempotencyStore), so it is wired with
// concrete impls by the app and with fakes by its tests. It returns a Result and never throws across
// the boundary; every failure is a code in the closed taxonomy (FR-5).

import type {
  AccessToken,
  ActionCatalog,
  ActionSpec,
  AuditSink,
  ExecuteRequest,
  ExecuteResult,
  IdempotencyStore,
  ProviderInvoker,
  Result,
  TenantPrincipal,
  TokenResolver,
} from '@conduit/contracts'
import { conduitError, err, ok } from '@conduit/contracts'
import { renderRequest } from '@conduit/provider-invoker'
import { ArgsValidator } from './validate-args'
import { normalize } from './normalize'

/** The five seams the Executor drives, injected so impls are leaves the app wires together. */
export interface ExecutorPorts {
  readonly catalog: ActionCatalog
  readonly tokenResolver: TokenResolver
  readonly invoker: ProviderInvoker
  readonly audit: AuditSink
  readonly idempotency: IdempotencyStore
}

export interface ExecutorOptions {
  /** Epoch-millisecond clock; injected so audit timestamps and latency are deterministic in tests. */
  readonly now?: () => number
}

export class Executor {
  readonly #catalog: ActionCatalog
  readonly #tokenResolver: TokenResolver
  readonly #invoker: ProviderInvoker
  readonly #audit: AuditSink
  readonly #idempotency: IdempotencyStore
  readonly #now: () => number
  readonly #argsValidator = new ArgsValidator()

  constructor(ports: ExecutorPorts, options: ExecutorOptions = {}) {
    this.#catalog = ports.catalog
    this.#tokenResolver = ports.tokenResolver
    this.#invoker = ports.invoker
    this.#audit = ports.audit
    this.#idempotency = ports.idempotency
    this.#now = options.now ?? Date.now
  }

  /** Execute one action for one end-user, recording the outcome regardless of success or failure. */
  async execute(
    principal: TenantPrincipal,
    request: ExecuteRequest,
  ): Promise<Result<ExecuteResult>> {
    const startedMs = this.#now()
    const result = await this.#run(principal, request)
    // The audit record (FR-10) carries an outcome code, never secrets or the provider payload.
    await this.#audit.record({
      tenantId: principal.tenantId,
      endUserId: request.endUserId,
      action: request.action,
      outcome: result.ok ? 'ok' : result.error.code,
      startedAt: new Date(startedMs).toISOString(),
      latencyMs: this.#now() - startedMs,
    })
    return result
  }

  /** The pipeline. Each step short-circuits to its own Result; a later step never sees a failed one. */
  async #run(
    principal: TenantPrincipal,
    request: ExecuteRequest,
  ): Promise<Result<ExecuteResult>> {
    const spec = this.#catalog.get(request.action)
    if (spec === undefined) {
      return err(conduitError('validation_error', `unknown action "${request.action}"`))
    }

    const argsCheck = this.#argsValidator.validate(spec, request.args)
    if (!argsCheck.ok) return argsCheck

    const { idempotencyKey } = request
    if (idempotencyKey !== undefined) {
      const replay = await this.#idempotency.get(principal.tenantId, idempotencyKey)
      if (replay !== null) return ok(replay)
    }

    const token = await this.#tokenResolver.resolve(principal, request.endUserId, spec.provider)
    if (!token.ok) return token

    const sent = await this.#invoke(spec, request.args, token.value)
    if (!sent.ok) return sent

    const result: ExecuteResult = { data: normalize(spec.normalize, sent.value), raw: sent.value }

    // Only successful results are cached, so a transient failure can be retried under the same key.
    if (idempotencyKey !== undefined) {
      await this.#idempotency.put(principal.tenantId, idempotencyKey, result)
    }
    return ok(result)
  }

  /** Render the spec + args into a request and send it through the SSRF-guarded invoker port. */
  async #invoke(
    spec: ActionSpec,
    args: Record<string, unknown>,
    token: AccessToken,
  ): Promise<Result<unknown>> {
    const rendered = renderRequest(spec, args)
    if (!rendered.ok) return rendered
    return this.#invoker.call(spec, rendered.value, token)
  }
}
