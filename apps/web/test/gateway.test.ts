import { describe, it, expect } from 'vitest'
import { handleExecute, handleListTools } from '../lib/server/gateway'
import { buildServices, jsonRequest, notConnected } from './helpers'

// The REST Gateway (SAD §Gateway, FR-3/4/5): thin route handlers that authenticate the caller to a
// tenant via @conduit/identity, validate the request envelope, make exactly one Executor call, and
// map the typed Result onto HTTP. These specs pin both surfaces (GET /tools, POST /execute) and the
// error contract: missing/invalid key → 401; the closed taxonomy maps through statusForCode (bad
// args → 400, no connection → 409); the surface invents no business errors.

const TOOLS_URL = 'http://localhost/api/v1/tools'
const EXECUTE_URL = 'http://localhost/api/v1/execute'

const bearer = (apiKey?: string): Request =>
  new Request(TOOLS_URL, apiKey === undefined ? {} : { headers: { authorization: `Bearer ${apiKey}` } })

describe('GET /api/v1/tools', () => {
  it('returns the catalog tool definitions for an authenticated caller (FR-3)', async () => {
    const { services, apiKey } = await buildServices()
    const res = await handleListTools(services, bearer(apiKey))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tools: { name: string; inputSchema: unknown }[] }
    const names = body.tools.map((t) => t.name)
    expect(names).toContain('github.get_authenticated_user')
    const tool = body.tools.find((t) => t.name === 'github.get_authenticated_user')
    expect(tool?.inputSchema).toBeTypeOf('object')
  })

  it('rejects a request with no API key as 401', async () => {
    const { services } = await buildServices()
    const res = await handleListTools(services, bearer(undefined))
    expect(res.status).toBe(401)
  })

  it('rejects a request with an unknown API key as 401', async () => {
    const { services } = await buildServices()
    const res = await handleListTools(services, bearer('cdt_not_a_real_key'))
    expect(res.status).toBe(401)
  })
})

describe('POST /api/v1/execute', () => {
  it('executes an action and returns the {data,raw} envelope (FR-4)', async () => {
    const { services, apiKey } = await buildServices()
    const req = jsonRequest(
      EXECUTE_URL,
      'POST',
      { action: 'github.get_authenticated_user', endUserId: 'alice', args: {} },
      apiKey,
    )
    const res = await handleExecute(services, req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { login: string }; raw: { login: string } }
    expect(body.data.login).toBe('alice')
    expect(body.raw.login).toBe('alice')
  })

  it('records an audit entry under the authenticated tenant (FR-10)', async () => {
    const { services, apiKey, audit } = await buildServices()
    const req = jsonRequest(
      EXECUTE_URL,
      'POST',
      { action: 'github.get_authenticated_user', endUserId: 'alice', args: {} },
      apiKey,
    )
    await handleExecute(services, req)
    expect(audit.entries[0]?.outcome).toBe('ok')
    expect(audit.entries[0]?.tenantId).toBe('tenant_acme')
  })

  it('rejects a request with no API key as 401, without executing', async () => {
    const { services, audit } = await buildServices()
    const req = jsonRequest(EXECUTE_URL, 'POST', {
      action: 'github.get_authenticated_user',
      endUserId: 'alice',
      args: {},
    })
    const res = await handleExecute(services, req)
    expect(res.status).toBe(401)
    expect(audit.entries).toHaveLength(0)
  })

  it('maps schema-invalid args to 400 validation_error (FR-5)', async () => {
    const { services, apiKey } = await buildServices()
    const req = jsonRequest(
      EXECUTE_URL,
      'POST',
      { action: 'github.get_authenticated_user', endUserId: 'alice', args: { surprise: 1 } },
      apiKey,
    )
    const res = await handleExecute(services, req)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('validation_error')
  })

  it('maps an unknown action to 400 validation_error', async () => {
    const { services, apiKey } = await buildServices()
    const req = jsonRequest(
      EXECUTE_URL,
      'POST',
      { action: 'github.does_not_exist', endUserId: 'alice', args: {} },
      apiKey,
    )
    const res = await handleExecute(services, req)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('validation_error')
  })

  it('maps a malformed envelope (missing action) to 400 validation_error', async () => {
    const { services, apiKey } = await buildServices()
    const req = jsonRequest(EXECUTE_URL, 'POST', { endUserId: 'alice', args: {} }, apiKey)
    const res = await handleExecute(services, req)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('validation_error')
  })

  it('maps malformed JSON to 400 validation_error', async () => {
    const { services, apiKey } = await buildServices()
    const req = new Request(EXECUTE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: '{ not json',
    })
    const res = await handleExecute(services, req)
    expect(res.status).toBe(400)
  })

  it('maps a not-connected end-user to 409 not_connected (FR-5)', async () => {
    const { services, apiKey } = await buildServices({ token: notConnected() })
    const req = jsonRequest(
      EXECUTE_URL,
      'POST',
      { action: 'github.get_authenticated_user', endUserId: 'alice', args: {} },
      apiKey,
    )
    const res = await handleExecute(services, req)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('not_connected')
  })
})
