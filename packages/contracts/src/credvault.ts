import { z } from 'zod'

/**
 * The pinned shape of credvault's `GET /v1/credentials/:provider` success response. This is
 * the conduit↔credvault contract (ADR-002); changing it requires a contracts amendment branch.
 */
export const CredvaultCredential = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_at: z.string().nullable(),
  scopes: z.array(z.string()),
})
export type CredvaultCredential = z.infer<typeof CredvaultCredential>

/**
 * An access token resolved for a single outbound provider call. The token string is
 * secret-bearing and must never be logged or persisted (NFR-SEC-3).
 */
export interface AccessToken {
  readonly accessToken: string
  readonly tokenType: string
  readonly expiresAt: string | null
  readonly scopes: readonly string[]
}
