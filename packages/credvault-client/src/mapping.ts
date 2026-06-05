// Pure translation between credvault's HTTP vocabulary and conduit's contracts. No I/O lives here,
// so the whole response→Result decision is unit-testable in isolation from transport.

import { z } from 'zod'
import type { AccessToken, ConduitError } from '@conduit/contracts'
import { CredvaultCredential, conduitError } from '@conduit/contracts'

const CredvaultErrorBody = z.object({ code: z.string(), message: z.string() })

/** Project credvault's success body onto our AccessToken, or null if it broke the frozen contract. */
export function toAccessToken(body: unknown): AccessToken | null {
  const parsed = CredvaultCredential.safeParse(body)
  if (!parsed.success) return null
  const credential = parsed.data
  return {
    accessToken: credential.access_token,
    tokenType: credential.token_type,
    expiresAt: credential.expires_at,
    scopes: credential.scopes,
  }
}

/** Map a credvault non-200 response onto the closed ConduitError taxonomy (FR-5). */
export function errorForResponse(status: number, body: unknown): ConduitError {
  const code = CredvaultErrorBody.safeParse(body).data?.code
  switch (status) {
    case 400:
      return conduitError('validation_error', 'credvault rejected the request as invalid')
    case 401:
    case 403:
      // conduit's own credvault key is wrong — an operator misconfiguration, not an agent error.
      return conduitError('internal', 'conduit is not authorized to credvault')
    case 404:
      return code === 'unknown_provider'
        ? conduitError('validation_error', 'unknown provider')
        : conduitError('not_connected', 'no connection for this end-user and provider')
    case 409:
      return conduitError('not_connected', 'the connection needs re-authorization')
    case 429:
      return conduitError('rate_limited', 'credvault is rate limiting this tenant')
    case 502:
    case 503:
      return conduitError('provider_error', 'credvault could not broker a token upstream')
    default:
      return conduitError('internal', `credvault returned an unexpected status ${status}`)
  }
}
