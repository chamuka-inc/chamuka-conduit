import type { Result, AccessToken, TenantPrincipal, EndUserId } from '@conduit/contracts'
import { conduitError, ok, err } from '@conduit/contracts'
import { toAccessToken, errorForResponse } from './mapping'

// A narrow view of fetch — just what the client uses. The global fetch is assignable to it, and
// tests can supply a fake without casts or a DOM lib (ENGINEERING_DISCIPLINE: no type-lying casts).
export interface HttpResponse {
  readonly status: number
  json(): Promise<unknown>
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<HttpResponse>

export interface CredvaultClientOptions {
  /** Origin of the running credvault, e.g. http://localhost:8000. */
  readonly baseUrl: string
  /**
   * Resolve the credvault tenant API key (a server-side secret conduit holds) for a principal's
   * credvaultTenantRef. The ref is not the secret (it is a non-secret reference), so the key comes
   * from here. Returns undefined when conduit holds no key for that ref.
   */
  readonly tenantKeyFor: (credvaultTenantRef: string) => string | undefined
  /** Injected for testability; defaults to the global fetch. */
  readonly fetch?: FetchLike
  /** Per-request deadline in milliseconds (default 10s). */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

/** Client for credvault's token-brokering API (ADR-002). Implements the TokenResolver port (FR-6). */
export class CredvaultClient {
  readonly #baseUrl: string
  readonly #tenantKeyFor: (ref: string) => string | undefined
  readonly #fetch: FetchLike
  readonly #timeoutMs: number

  constructor(options: CredvaultClientOptions) {
    this.#baseUrl = options.baseUrl
    this.#tenantKeyFor = options.tenantKeyFor
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async resolve(
    tenant: TenantPrincipal,
    endUserId: EndUserId,
    provider: string,
  ): Promise<Result<AccessToken>> {
    const key = this.#tenantKeyFor(tenant.credvaultTenantRef)
    if (key === undefined) {
      return err(conduitError('internal', 'no credvault key configured for this tenant'))
    }

    const url = new URL(`/v1/credentials/${encodeURIComponent(provider)}`, this.#baseUrl)
    url.searchParams.set('external_user_id', endUserId)

    let response: HttpResponse
    try {
      response = await this.#send(url.toString(), key)
    } catch (error) {
      return isAbortError(error)
        ? err(conduitError('upstream_timeout', 'credvault did not respond in time'))
        : err(conduitError('internal', 'credvault request failed'))
    }

    const body = await response.json().catch(() => null)
    if (response.status === 200) {
      const token = toAccessToken(body)
      return token === null
        ? err(conduitError('internal', 'malformed credvault credential response'))
        : ok(token)
    }
    return err(errorForResponse(response.status, body))
  }

  /** One GET to credvault, bounded by the deadline. Throws on transport failure or timeout. */
  async #send(url: string, key: string): Promise<HttpResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs)
    try {
      return await this.#fetch(url, {
        headers: { authorization: `Bearer ${key}` },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}
