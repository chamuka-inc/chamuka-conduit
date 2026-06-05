// The ProviderInvoker port impl (FR-4d, FR-11): SSRF-guard a rendered request, inject the resolved
// token, send it under a deadline, and map the outcome onto the closed ConduitError taxonomy. The
// token is used here and never logged or persisted (NFR-SEC-3). Returns the provider's raw JSON;
// normalization into the {data,raw} envelope is the Executor's job (module 6).

import type { Result, ActionSpec, RenderedRequest, AccessToken, ProviderInvoker } from '@conduit/contracts'
import { ok, err, conduitError } from '@conduit/contracts'
import { validateTarget } from './ssrf'

// A narrow view of fetch — just what the invoker uses. The global fetch is assignable to it, and
// tests can supply a fake without casts or a DOM lib (ENGINEERING_DISCIPLINE: no type-lying casts).
export interface HttpResponse {
  readonly status: number
  json(): Promise<unknown>
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<HttpResponse>

export interface HttpProviderInvokerOptions {
  /** Injected for testability; defaults to the global fetch. */
  readonly fetch?: FetchLike
  /** Per-request deadline in milliseconds (default 10s). */
  readonly timeoutMs?: number
  /** Sent as User-Agent when the rendered request does not set one (some providers require it). */
  readonly userAgent?: string
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_USER_AGENT = 'conduit-provider-invoker'

/** SSRF-safe outbound provider call (FR-4d, FR-11). Implements the ProviderInvoker port. */
export class HttpProviderInvoker implements ProviderInvoker {
  readonly #fetch: FetchLike
  readonly #timeoutMs: number
  readonly #userAgent: string

  constructor(options: HttpProviderInvokerOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  }

  async call(
    spec: ActionSpec,
    request: RenderedRequest,
    token: AccessToken,
  ): Promise<Result<unknown>> {
    const guard = validateTarget(request.url, spec.providerHosts)
    if (!guard.ok) return guard

    // The default User-Agent is overridable by the spec; the token always wins on Authorization.
    const headers: Record<string, string> = {
      'user-agent': this.#userAgent,
      ...request.headers,
      authorization: `${token.tokenType} ${token.accessToken}`,
    }
    let body: string | undefined
    if (request.body !== undefined) {
      body = JSON.stringify(request.body)
      if (!hasHeader(headers, 'content-type')) headers['content-type'] = 'application/json'
    }

    let response: HttpResponse
    try {
      response = await this.#send(request.method, request.url, headers, body)
    } catch (error) {
      return isAbortError(error)
        ? err(conduitError('upstream_timeout', 'the provider did not respond in time'))
        : err(conduitError('internal', 'the provider request failed in transport'))
    }

    if (response.status >= 200 && response.status < 300) {
      return ok(await response.json().catch(() => null))
    }
    return err(errorForStatus(response.status))
  }

  /** One request to the provider, bounded by the deadline. Throws on transport failure or timeout. */
  async #send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<HttpResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs)
    try {
      return await this.#fetch(url, { method, headers, body, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Map a non-2xx provider status onto the closed taxonomy (FR-5). */
function errorForStatus(status: number) {
  if (status === 429) return conduitError('rate_limited', 'the provider is rate limiting this call')
  return conduitError('provider_error', `the provider returned ${status}`)
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name)
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}
