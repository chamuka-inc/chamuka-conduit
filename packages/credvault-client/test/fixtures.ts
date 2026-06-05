// Shared builders for the credvault-client tests. The client depends on a narrow FetchLike seam
// (not the global fetch type), so these fakes need no casts and no DOM lib.

import { TenantId, EndUserId } from '@conduit/contracts'
import type { TenantPrincipal } from '@conduit/contracts'
import type { FetchLike, HttpResponse } from '../src/index'

export const principal = (credvaultTenantRef = 'verify-acme'): TenantPrincipal => ({
  tenantId: TenantId.parse('acme'),
  credvaultTenantRef,
})

export const endUser = (s = 'alice') => EndUserId.parse(s)

export const credentialBody = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'gho_live_token',
  token_type: 'Bearer',
  expires_at: null,
  scopes: ['repo', 'read:user'],
  ...overrides,
})

export interface CapturedRequest {
  readonly url: string
  readonly authorization: string | undefined
}

/** A FetchLike that records each request and returns one canned response. */
export function stubFetch(
  status: number,
  body: unknown,
): { fetch: FetchLike; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const response: HttpResponse = { status, json: () => Promise.resolve(body) }
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, authorization: init?.headers?.authorization })
    return Promise.resolve(response)
  }
  return { fetch, calls }
}

/** A FetchLike that never resolves until the request's abort signal fires (to drive a timeout). */
export const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'))
    })
  })

/** A FetchLike that rejects as a transport failure would (DNS, connection refused, …). */
export const failingFetch: FetchLike = () => Promise.reject(new TypeError('connection refused'))
