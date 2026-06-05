// Conduit API-key primitives, same posture as credvault's tenant keys (src/auth.rs): a prefixed,
// high-entropy key minted from a CSPRNG, of which only the SHA-256 digest is ever stored (NFR-SEC-1).

import { randomBytes, createHash } from 'node:crypto'

/** Prefix on every issued conduit API key — identifies the credential type so secret scanners can
 * flag a leak, and distinguishes it from credvault's own `cvk_` tenant keys. */
export const API_KEY_PREFIX = 'cdt_'

/** Mint a fresh conduit API key: prefix + 256 bits of CSPRNG entropy, URL-safe (unpadded base64url). */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** SHA-256 (base64url) of a presented key. Only this digest is stored or indexed, so the tenant
 * table reveals nothing usable if exfiltrated; a 256-bit digest of a high-entropy secret has no
 * practical timing oracle. Mirror of credvault's token_hash. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('base64url')
}
