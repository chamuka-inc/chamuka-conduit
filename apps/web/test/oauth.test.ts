import { describe, it, expect } from 'vitest'
import { OAuthMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js'
import { s256Challenge, verifyPkce } from '../lib/server/oauth/pkce'
import { signAccessToken, verifyAccessToken } from '../lib/server/oauth/tokens'
import { authorizationServerMetadata } from '../lib/server/oauth/metadata'
import { OAuthStore } from '../lib/server/oauth/store'
import { handleAuthorize, handleRegister, handleToken } from '../lib/server/oauth/endpoints'
import { buildServices, oauthConfig } from './helpers'

// conduit acts as its own OAuth 2.1 Authorization Server for the MCP Resource Server (MCP auth spec
// 2025-06-18, user chose full OAuth 2.1). These specs pin the security-critical pieces: PKCE S256,
// audience-bound signed access tokens, RFC 8414 metadata, RFC 7591 dynamic client registration, and
// the authorize→token authorization-code exchange. The resource owner is authenticated by their
// conduit API key (@conduit/identity), binding the issued token to that tenant + an end-user.

describe('PKCE (S256)', () => {
  it('accepts a verifier whose S256 challenge matches', () => {
    const verifier = 'a'.repeat(64)
    expect(verifyPkce(verifier, s256Challenge(verifier))).toBe(true)
  })

  it('rejects a mismatched verifier', () => {
    expect(verifyPkce('the-wrong-verifier', s256Challenge('a'.repeat(64)))).toBe(false)
  })
})

describe('access tokens', () => {
  const config = oauthConfig()
  const claims = { tenantId: 'tenant_acme', credvaultTenantRef: 'verify-acme', endUserId: 'alice' }

  it('signs a token that verifies back to its claims, audience, and client', async () => {
    const token = await signAccessToken(config, claims, 'client-123', ['mcp'])
    const verified = await verifyAccessToken(config, token)
    expect(verified).not.toBeNull()
    expect(verified?.claims).toEqual(claims)
    expect(verified?.clientId).toBe('client-123')
    expect(verified?.scopes).toContain('mcp')
  })

  it('rejects a token whose audience is not conduit\'s MCP resource', async () => {
    const token = await signAccessToken(config, claims, 'client-123', ['mcp'])
    const otherResource = oauthConfig({ resource: 'http://evil.example/api/mcp' })
    expect(await verifyAccessToken(otherResource, token)).toBeNull()
  })

  it('rejects a garbage/forged token', async () => {
    expect(await verifyAccessToken(config, 'not.a.jwt')).toBeNull()
  })
})

describe('authorization server metadata (RFC 8414)', () => {
  it('is valid per the MCP SDK schema and advertises S256 + the code grant', () => {
    const meta = authorizationServerMetadata(oauthConfig())
    expect(() => OAuthMetadataSchema.parse(meta)).not.toThrow()
    expect(meta.issuer).toBe('http://localhost:3000')
    expect(meta.code_challenge_methods_supported).toContain('S256')
    expect(meta.response_types_supported).toContain('code')
  })
})

describe('dynamic client registration (RFC 7591)', () => {
  it('registers a client and returns a generated client_id with its redirect URIs', async () => {
    const store = new OAuthStore()
    const req = new Request('http://localhost:3000/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://localhost:9999/callback'], client_name: 'Test' }),
    })
    const res = await handleRegister({ store }, req)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { client_id: string; redirect_uris: string[] }
    expect(body.client_id).toBeTypeOf('string')
    expect(body.redirect_uris).toEqual(['http://localhost:9999/callback'])
    expect(store.getClient(body.client_id)).toBeDefined()
  })

  it('rejects registration with no redirect_uris', async () => {
    const store = new OAuthStore()
    const req = new Request('http://localhost:3000/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'No Redirects' }),
    })
    const res = await handleRegister({ store }, req)
    expect(res.status).toBe(400)
  })
})

describe('authorization code grant (authorize → token)', () => {
  const config = oauthConfig()
  const redirectUri = 'http://localhost:9999/callback'

  async function registerClient(store: OAuthStore): Promise<string> {
    const res = await handleRegister(
      { store },
      new Request('http://localhost:3000/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [redirectUri] }),
      }),
    )
    return ((await res.json()) as { client_id: string }).client_id
  }

  function authorizeUrl(clientId: string, challenge: string): string {
    const u = new URL('http://localhost:3000/oauth/authorize')
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('redirect_uri', redirectUri)
    u.searchParams.set('code_challenge', challenge)
    u.searchParams.set('code_challenge_method', 'S256')
    u.searchParams.set('state', 'xyz')
    u.searchParams.set('resource', config.resource)
    u.searchParams.set('end_user_id', 'alice')
    return u.toString()
  }

  it('issues a code (302 to the redirect_uri, preserving state) for an API-key-authenticated owner', async () => {
    const { services, apiKey } = await buildServices()
    const store = new OAuthStore()
    const clientId = await registerClient(store)
    const req = new Request(authorizeUrl(clientId, s256Challenge('v'.repeat(64))), {
      headers: { authorization: `Bearer ${apiKey}` },
    })
    const res = await handleAuthorize({ store, identity: services.identity, config }, req)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe(redirectUri)
    expect(location.searchParams.get('code')).toBeTruthy()
    expect(location.searchParams.get('state')).toBe('xyz')
  })

  it('rejects authorize without a valid conduit API key (401)', async () => {
    const { services } = await buildServices()
    const store = new OAuthStore()
    const clientId = await registerClient(store)
    const req = new Request(authorizeUrl(clientId, s256Challenge('v'.repeat(64))))
    const res = await handleAuthorize({ store, identity: services.identity, config }, req)
    expect(res.status).toBe(401)
  })

  it('rejects authorize without PKCE S256 (400)', async () => {
    const { services, apiKey } = await buildServices()
    const store = new OAuthStore()
    const clientId = await registerClient(store)
    const u = new URL(authorizeUrl(clientId, ''))
    u.searchParams.delete('code_challenge')
    u.searchParams.delete('code_challenge_method')
    const req = new Request(u.toString(), { headers: { authorization: `Bearer ${apiKey}` } })
    const res = await handleAuthorize({ store, identity: services.identity, config }, req)
    expect(res.status).toBe(400)
  })

  async function getCode(store: OAuthStore, identity: BuiltIdentity, apiKey: string, clientId: string, verifier: string): Promise<string> {
    const req = new Request(authorizeUrl(clientId, s256Challenge(verifier)), {
      headers: { authorization: `Bearer ${apiKey}` },
    })
    const res = await handleAuthorize({ store, identity, config }, req)
    const location = new URL(res.headers.get('location') ?? '')
    return location.searchParams.get('code') ?? ''
  }

  type BuiltIdentity = Awaited<ReturnType<typeof buildServices>>['services']['identity']

  function tokenRequest(clientId: string, code: string, verifier: string): Request {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    })
    return new Request('http://localhost:3000/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
  }

  it('exchanges a code + matching verifier for an audience-bound access token', async () => {
    const { services, apiKey } = await buildServices()
    const store = new OAuthStore()
    const clientId = await registerClient(store)
    const verifier = 'v'.repeat(64)
    const code = await getCode(store, services.identity, apiKey, clientId, verifier)

    const res = await handleToken({ store, config }, tokenRequest(clientId, code, verifier))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { access_token: string; token_type: string }
    expect(body.token_type.toLowerCase()).toBe('bearer')
    const verified = await verifyAccessToken(config, body.access_token)
    expect(verified?.claims.endUserId).toBe('alice')
    expect(verified?.claims.tenantId).toBe('tenant_acme')
  })

  it('rejects a token exchange with the wrong PKCE verifier (400)', async () => {
    const { services, apiKey } = await buildServices()
    const store = new OAuthStore()
    const clientId = await registerClient(store)
    const code = await getCode(store, services.identity, apiKey, clientId, 'v'.repeat(64))

    const res = await handleToken({ store, config }, tokenRequest(clientId, code, 'wrong-verifier'))
    expect(res.status).toBe(400)
  })

  it('rejects reuse of an authorization code (single-use)', async () => {
    const { services, apiKey } = await buildServices()
    const store = new OAuthStore()
    const clientId = await registerClient(store)
    const verifier = 'v'.repeat(64)
    const code = await getCode(store, services.identity, apiKey, clientId, verifier)

    const first = await handleToken({ store, config }, tokenRequest(clientId, code, verifier))
    expect(first.status).toBe(200)
    const second = await handleToken({ store, config }, tokenRequest(clientId, code, verifier))
    expect(second.status).toBe(400)
  })
})
