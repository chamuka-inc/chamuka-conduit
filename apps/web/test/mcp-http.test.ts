import { describe, it, expect } from 'vitest'
import { buildMcpHandler } from '../lib/server/mcp-route'
import { signAccessToken } from '../lib/server/oauth/tokens'
import { buildServices, oauthConfig } from './helpers'

// E2E for the MCP surface through the real mcp-handler transport (FR-8): the OAuth bearer guard, the
// JSON-RPC dispatch, and the catalog/executor wiring composed end-to-end over the streamable-HTTP
// handler, with the Executor backed by in-memory peers. This is the seam the unit specs (mcp.test,
// oauth.test) can't cover — that withMcpAuth + setRequestHandler + our logic actually fit together.

const MCP_URL = 'http://localhost:3000/api/mcp'
const config = oauthConfig()

/** mcp-handler streams a single JSON-RPC response as SSE; pull the `data:` payload back out. */
function parseSse(text: string): { result?: Record<string, unknown>; error?: unknown } {
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  return JSON.parse((line ?? '{}').slice('data:'.length).trim())
}

async function rpc(
  handler: (r: Request) => Promise<Response>,
  token: string | null,
  body: unknown,
): Promise<{ status: number; payload: { result?: Record<string, unknown>; error?: unknown } }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (token !== null) headers.authorization = `Bearer ${token}`
  const res = await handler(new Request(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body) }))
  const text = await res.text()
  return { status: res.status, payload: res.status === 200 ? parseSse(text) : { result: undefined } }
}

const listRequest = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
const callRequest = (args: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'github.get_authenticated_user', arguments: args },
})

async function mintToken(endUserId = 'alice'): Promise<string> {
  const { principal } = await buildServices()
  return signAccessToken(
    config,
    { tenantId: principal.tenantId, credvaultTenantRef: principal.credvaultTenantRef, endUserId },
    'client-test',
    ['mcp'],
  )
}

describe('MCP over HTTP (OAuth-guarded streamable transport)', () => {
  it('rejects an unauthenticated request with 401 + WWW-Authenticate pointing at the PRM', async () => {
    const { services } = await buildServices()
    const res = await buildMcpHandler(services, config)(
      new Request(MCP_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    )
    expect(res.status).toBe(401)
    // The advertised discovery URL must be the origin-level path conduit actually serves the
    // protected-resource metadata at — otherwise an MCP client's discovery 404s (regression guard).
    expect(res.headers.get('www-authenticate')).toContain(
      'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"',
    )
  })

  it('rejects a forged bearer token with 401', async () => {
    const { services } = await buildServices()
    const { status } = await rpc(buildMcpHandler(services, config), 'not.a.valid.token', listRequest)
    expect(status).toBe(401)
  })

  it('lists the catalog actions as MCP tools for a valid token (tools/list)', async () => {
    const { services } = await buildServices()
    const token = await mintToken()
    const { status, payload } = await rpc(buildMcpHandler(services, config), token, listRequest)
    expect(status).toBe(200)
    const tools = payload.result?.tools as { name: string }[]
    expect(tools.map((t) => t.name)).toContain('github.get_authenticated_user')
  })

  it('executes an action for the token-bound end-user and returns structured content (tools/call)', async () => {
    const { services } = await buildServices()
    const token = await mintToken('alice')
    const { status, payload } = await rpc(buildMcpHandler(services, config), token, callRequest())
    expect(status).toBe(200)
    const result = payload.result as { structuredContent?: { data?: { login?: string } }; isError?: boolean }
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent?.data?.login).toBe('alice')
  })

  it('surfaces an invalid tool invocation as an MCP tool error, not a transport failure', async () => {
    const { services } = await buildServices()
    const token = await mintToken()
    const { status, payload } = await rpc(buildMcpHandler(services, config), token, callRequest({ surprise: 1 }))
    expect(status).toBe(200)
    const result = payload.result as { isError?: boolean }
    expect(result.isError).toBe(true)
  })
})
