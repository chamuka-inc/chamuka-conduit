import { describe, it, expect, beforeAll } from 'vitest'
import { TenantId } from '@conduit/contracts'
import { resolveLiveEnv } from '@conduit/test-support'
// Static imports are safe: these modules read env lazily (only when getServices()/runMigrations is
// first called, in beforeAll), which is after the env block below has run during module evaluation.
import {
  getOAuthConfig,
  getOAuthStore,
  getServices,
  runMigrations,
} from '../lib/server/container'
import { handleExecute, handleListTools } from '../lib/server/gateway'
import { handleAuthorize, handleRegister, handleToken } from '../lib/server/oauth/endpoints'
import { buildMcpHandler } from '../lib/server/mcp-route'
import { s256Challenge } from '../lib/server/oauth/pkce'

// Live acceptance for module 7 (PLAN §7), end-to-end against the running stack: the real container
// wires the Executor to credvault (:8000) + Postgres + api.github.com, and conduit's own OAuth 2.1
// AS mints the MCP token. Gated on env so the offline verify stays green; run with
//   CONDUIT_CREDVAULT_URL=http://localhost:8000 CONDUIT_TENANT_KEY_FILE=/path/to/tenant_key.txt \
//   CONDUIT_TEST_DATABASE_URL=postgres://vault:vault@localhost:5432/vault pnpm test
// (or pass the key value via CONDUIT_CREDVAULT_TENANT_KEY). The route files are one-line adapters
// over these handlers, so driving the handlers with the live container is the live acceptance
// (REST GET /tools + POST /execute; the MCP OAuth dance + tools/call).
const { baseUrl, tenantKey, databaseUrl, hasCredvault } = resolveLiveEnv()
const canRun = hasCredvault

if (canRun) {
  process.env.CONDUIT_CREDVAULT_URL = baseUrl
  process.env.CONDUIT_CREDVAULT_TENANT_KEY = tenantKey
  process.env.CONDUIT_CREDVAULT_TENANT_REF = 'verify-acme'
  process.env.CONDUIT_DATABASE_URL = databaseUrl || 'postgres://vault:vault@localhost:5432/vault'
  process.env.CONDUIT_PUBLIC_URL = 'http://localhost:3000'
  process.env.CONDUIT_OAUTH_SIGNING_SECRET = 'conduit-live-test-oauth-signing-secret-0123456789'
}

const live = canRun ? describe : describe.skip

const TOOLS_URL = 'http://localhost:3000/api/v1/tools'
const EXECUTE_URL = 'http://localhost:3000/api/v1/execute'
const MCP_URL = 'http://localhost:3000/api/mcp'
const REDIRECT_URI = 'http://localhost:9999/callback'

function parseSse(text: string): { result?: Record<string, unknown> } {
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  return JSON.parse((line ?? '{}').slice('data:'.length).trim())
}

live('@conduit/web live acceptance — REST + MCP against the running stack', () => {
  let apiKey = ''

  beforeAll(async () => {
    await runMigrations()
    const issued = await getServices().identity.issue({
      tenantId: TenantId.parse(`conduit-web-live-${Date.now()}`),
      credvaultTenantRef: 'verify-acme',
    })
    apiKey = issued.apiKey
  })

  const authed = (url: string, init: RequestInit = {}): Request =>
    new Request(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${apiKey}` } })

  const executeBody = (endUserId: string, args: Record<string, unknown> = {}): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'github.get_authenticated_user', endUserId, args }),
  })

  it('GET /tools returns the catalog tool definitions (FR-3)', async () => {
    const res = await handleListTools(getServices(), authed(TOOLS_URL))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tools: { name: string }[] }
    expect(body.tools.map((t) => t.name)).toContain('github.get_authenticated_user')
  })

  it('POST /execute brokers a real token and returns the normalized profile for alice (FR-4)', async () => {
    const res = await handleExecute(getServices(), authed(EXECUTE_URL, executeBody('alice')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { login?: unknown }; raw: { login?: unknown } }
    expect(typeof body.data.login).toBe('string')
    expect(typeof body.raw.login).toBe('string')
  })

  it('POST /execute with schema-invalid args is 400 (FR-5)', async () => {
    const res = await handleExecute(
      getServices(),
      authed(EXECUTE_URL, executeBody('alice', { surprise: 1 })),
    )
    expect(res.status).toBe(400)
  })

  it('POST /execute for an unconnected end-user is 409 not_connected (FR-5)', async () => {
    const res = await handleExecute(
      getServices(),
      authed(EXECUTE_URL, executeBody('no-such-end-user')),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('not_connected')
  })

  it('MCP: OAuth dance (register → authorize → token) then tools/call executes for alice (FR-8)', async () => {
    const config = getOAuthConfig()
    const store = getOAuthStore()

    const registered = await handleRegister(
      { store },
      new Request('http://localhost:3000/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: 'live-test' }),
      }),
    )
    const { client_id: clientId } = (await registered.json()) as { client_id: string }

    const verifier = 'live-verifier-'.padEnd(64, 'x')
    const authorizeUrl = new URL('http://localhost:3000/oauth/authorize')
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: s256Challenge(verifier),
      code_challenge_method: 'S256',
      resource: config.resource,
      end_user_id: 'alice',
      state: 'live',
    }).toString()
    const authorized = await handleAuthorize(
      { store, identity: getServices().identity, config },
      authed(authorizeUrl.toString()),
    )
    expect(authorized.status).toBe(302)
    const code = new URL(authorized.headers.get('location') ?? '').searchParams.get('code') ?? ''

    const tokenRes = await handleToken(
      { store, config },
      new Request('http://localhost:3000/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: verifier,
        }).toString(),
      }),
    )
    expect(tokenRes.status).toBe(200)
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string }

    const handler = buildMcpHandler(getServices(), config)
    const callRes = await handler(
      new Request(MCP_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'github.get_authenticated_user', arguments: {} },
        }),
      }),
    )
    expect(callRes.status).toBe(200)
    const payload = parseSse(await callRes.text())
    const result = payload.result as { structuredContent?: { data?: { login?: unknown } }; isError?: boolean }
    expect(result.isError).toBeFalsy()
    expect(typeof result.structuredContent?.data?.login).toBe('string')
  })
})
