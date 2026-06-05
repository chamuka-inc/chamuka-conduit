// The Authorization Server HTTP logic: dynamic client registration (RFC 7591), the authorization
// endpoint (RFC 6749 §4.1 with mandatory PKCE), and the token endpoint (authorization-code grant).
// The resource owner is authenticated by their conduit API key (@conduit/identity) at /authorize,
// which binds the issued code — and therefore the access token — to that tenant and a named
// end-user. Framework-agnostic (Web Request/Response + injected deps) so it unit-tests without Next.

import type { IdentityService } from '@conduit/identity'
import { bearerToken } from '../responses'
import type { OAuthConfig } from './config'
import { MCP_SCOPE } from './metadata'
import { verifyPkce } from './pkce'
import { signAccessToken } from './tokens'
import type { OAuthStore } from './store'

const AUTH_CODE_TTL_MS = 600_000

/** An OAuth error response (RFC 6749 §5.2 shape). */
function oauthError(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status })
}

/** POST /oauth/register — dynamic client registration (RFC 7591). */
export async function handleRegister(
  deps: { store: OAuthStore },
  request: Request,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return oauthError('invalid_client_metadata', 'request body is not valid JSON')
  }
  const redirectUris = extractRedirectUris(body)
  if (redirectUris === null) {
    return oauthError('invalid_redirect_uri', 'redirect_uris must be a non-empty array of URIs')
  }
  const clientName = extractClientName(body)
  const client = deps.store.registerClient({ redirectUris, clientName })
  return Response.json(
    {
      client_id: client.clientId,
      redirect_uris: client.redirectUris,
      ...(client.clientName !== undefined ? { client_name: client.clientName } : {}),
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    { status: 201 },
  )
}

/** GET /oauth/authorize — authenticate the owner by API key, then issue a PKCE-bound auth code. */
export async function handleAuthorize(
  deps: { store: OAuthStore; identity: IdentityService; config: OAuthConfig },
  request: Request,
): Promise<Response> {
  const params = new URL(request.url).searchParams

  const token = bearerToken(request)
  const principal = token === null ? null : await deps.identity.verify(token)
  if (principal === null) {
    return oauthError('access_denied', 'a valid conduit API key is required to authorize', 401)
  }

  if (params.get('response_type') !== 'code') {
    return oauthError('unsupported_response_type', 'only response_type=code is supported')
  }
  const client = deps.store.getClient(params.get('client_id') ?? '')
  if (client === undefined) return oauthError('invalid_client', 'unknown client_id')

  const redirectUri = params.get('redirect_uri') ?? ''
  if (!client.redirectUris.includes(redirectUri)) {
    return oauthError('invalid_request', 'redirect_uri is not registered for this client')
  }

  const codeChallenge = params.get('code_challenge') ?? ''
  if (codeChallenge === '' || params.get('code_challenge_method') !== 'S256') {
    return oauthError('invalid_request', 'PKCE with code_challenge_method=S256 is required')
  }

  const endUserId = params.get('end_user_id') ?? ''
  if (endUserId === '') {
    return oauthError('invalid_request', 'end_user_id is required to bind the session to an end-user')
  }

  const resource = params.get('resource')
  if (resource !== null && resource !== deps.config.resource) {
    return oauthError('invalid_target', 'resource does not match this MCP server')
  }

  const code = deps.store.issueCode({
    clientId: client.clientId,
    redirectUri,
    codeChallenge,
    resource: deps.config.resource,
    scope: params.get('scope') ?? MCP_SCOPE,
    claims: {
      tenantId: principal.tenantId,
      credvaultTenantRef: principal.credvaultTenantRef,
      endUserId,
    },
    expiresAtMs: Date.now() + AUTH_CODE_TTL_MS,
  })

  const location = new URL(redirectUri)
  location.searchParams.set('code', code)
  const state = params.get('state')
  if (state !== null) location.searchParams.set('state', state)
  return new Response(null, { status: 302, headers: { location: location.toString() } })
}

/** POST /oauth/token — exchange an authorization code + PKCE verifier for an access token. */
export async function handleToken(
  deps: { store: OAuthStore; config: OAuthConfig },
  request: Request,
): Promise<Response> {
  const form = new URLSearchParams(await request.text())
  if (form.get('grant_type') !== 'authorization_code') {
    return oauthError('unsupported_grant_type', 'only authorization_code is supported')
  }

  const record = deps.store.takeCode(form.get('code') ?? '')
  if (record === undefined) {
    return oauthError('invalid_grant', 'unknown or already-used authorization code')
  }
  if (Date.now() > record.expiresAtMs) {
    return oauthError('invalid_grant', 'authorization code has expired')
  }
  if (form.get('client_id') !== record.clientId) {
    return oauthError('invalid_grant', 'client_id does not match the authorization code')
  }
  if (form.get('redirect_uri') !== record.redirectUri) {
    return oauthError('invalid_grant', 'redirect_uri does not match the authorization code')
  }
  if (!verifyPkce(form.get('code_verifier') ?? '', record.codeChallenge)) {
    return oauthError('invalid_grant', 'PKCE verification failed')
  }

  const scopes = record.scope.split(' ').filter((s) => s !== '')
  const accessToken = await signAccessToken(deps.config, record.claims, record.clientId, scopes)
  return Response.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: deps.config.accessTokenTtlSeconds,
    scope: record.scope,
  })
}

function extractRedirectUris(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null
  const value = (body as Record<string, unknown>)['redirect_uris']
  if (!Array.isArray(value)) return null
  const uris = value.filter((u): u is string => typeof u === 'string' && u !== '')
  return uris.length === 0 || uris.length !== value.length ? null : uris
}

function extractClientName(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const value = (body as Record<string, unknown>)['client_name']
  return typeof value === 'string' ? value : undefined
}
