// PKCE (RFC 7636), S256 only — mandatory under the MCP authorization spec. The challenge is the
// base64url(SHA-256(verifier)); verification recomputes it and compares in constant time so a
// timing side channel can't leak how much of a guessed verifier was correct.

import { createHash, timingSafeEqual } from 'node:crypto'

/** The S256 code challenge for a verifier: base64url(SHA-256(verifier)). */
export function s256Challenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

/** True iff the verifier's S256 challenge equals the stored challenge (constant-time compare). */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const expected = Buffer.from(s256Challenge(codeVerifier))
  const presented = Buffer.from(codeChallenge)
  return expected.length === presented.length && timingSafeEqual(expected, presented)
}
