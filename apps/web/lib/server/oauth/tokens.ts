// MCP access tokens: short-lived, signed (HS256) JWTs, audience-bound to conduit's canonical MCP
// resource URI (RFC 8707). Signed tokens keep the Resource Server stateless — verification needs no
// token store, just the shared secret — while audience binding lets the MCP route reject any token
// minted for a different resource. The token carries the tenant (subject) + end-user it acts for.

import { SignJWT, jwtVerify } from 'jose'
import type { OAuthConfig } from './config'

/** The conduit identity a token binds: which tenant, its credvault ref, and the acting end-user. */
export interface McpTokenClaims {
  readonly tenantId: string
  readonly credvaultTenantRef: string
  readonly endUserId: string
}

export interface VerifiedToken {
  readonly claims: McpTokenClaims
  readonly clientId: string
  readonly scopes: string[]
  readonly expiresAt: number
}

const CLIENT_CLAIM = 'client_id'
const SCOPE_CLAIM = 'scope'
const CREDVAULT_REF_CLAIM = 'cvt_ref'
const END_USER_CLAIM = 'end_user_id'

/** Mint an access token for (tenant, end-user), bound to the configured MCP resource audience. */
export async function signAccessToken(
  config: OAuthConfig,
  claims: McpTokenClaims,
  clientId: string,
  scopes: readonly string[],
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return new SignJWT({
    [CREDVAULT_REF_CLAIM]: claims.credvaultTenantRef,
    [END_USER_CLAIM]: claims.endUserId,
    [CLIENT_CLAIM]: clientId,
    [SCOPE_CLAIM]: scopes.join(' '),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.tenantId)
    .setIssuer(config.issuer)
    .setAudience(config.resource)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + config.accessTokenTtlSeconds)
    .sign(config.signingSecret)
}

/** Verify a token's signature, issuer, and audience; null on any failure (forged, expired, wrong aud). */
export async function verifyAccessToken(
  config: OAuthConfig,
  token: string,
): Promise<VerifiedToken | null> {
  try {
    const { payload } = await jwtVerify(token, config.signingSecret, {
      issuer: config.issuer,
      audience: config.resource,
    })
    const tenantId = payload.sub
    const credvaultTenantRef = payload[CREDVAULT_REF_CLAIM]
    const endUserId = payload[END_USER_CLAIM]
    const clientId = payload[CLIENT_CLAIM]
    const scope = payload[SCOPE_CLAIM]
    if (
      typeof tenantId !== 'string' ||
      typeof credvaultTenantRef !== 'string' ||
      typeof endUserId !== 'string' ||
      typeof clientId !== 'string'
    ) {
      return null
    }
    return {
      claims: { tenantId, credvaultTenantRef, endUserId },
      clientId,
      scopes: typeof scope === 'string' ? scope.split(' ').filter((s) => s !== '') : [],
      expiresAt: typeof payload.exp === 'number' ? payload.exp : 0,
    }
  } catch {
    return null
  }
}
