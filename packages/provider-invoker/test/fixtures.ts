// Shared builders for the provider-invoker tests. The invoker depends on a narrow FetchLike seam
// (not the global fetch type), so these fakes need no casts and no DOM lib.

import { ActionName } from '@conduit/contracts'
import type { ActionSpec, AccessToken } from '@conduit/contracts'
import type { FetchLike, HttpResponse } from '../src/index'

/** A complete ActionSpec, defaulted to github.get_authenticated_user; override any field. */
export function spec(overrides: Partial<ActionSpec> = {}): ActionSpec {
  return {
    name: ActionName.parse('github.get_authenticated_user'),
    provider: 'github',
    description: 'Get the authenticated user',
    providerHosts: ['api.github.com'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object' },
    request: {
      method: 'GET',
      urlTemplate: 'https://api.github.com/user',
      headers: { accept: 'application/vnd.github+json' },
    },
    normalize: { login: 'login', id: 'id' },
    ...overrides,
  }
}

export const token = (overrides: Partial<AccessToken> = {}): AccessToken => ({
  accessToken: 'gho_live_token',
  tokenType: 'Bearer',
  expiresAt: null,
  scopes: ['read:user'],
  ...overrides,
})

export interface CapturedRequest {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string | undefined
}

/** A FetchLike that records each request and returns one canned response. */
export function stubFetch(
  status: number,
  body: unknown,
): { fetch: FetchLike; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const response: HttpResponse = { status, json: () => Promise.resolve(body) }
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body })
    return Promise.resolve(response)
  }
  return { fetch, calls }
}

/** A FetchLike that never resolves until the request's abort signal fires (to drive a timeout). */
export const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'))
    })
  })

/** A FetchLike that rejects as a transport failure would (DNS, connection refused, …). */
export const failingFetch: FetchLike = () => Promise.reject(new TypeError('connection refused'))
