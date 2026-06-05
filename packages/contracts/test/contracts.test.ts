import { describe, it, expect } from 'vitest'
import {
  ActionSpec,
  ExecuteRequest,
  ErrorCode,
  statusForCode,
  conduitError,
  CredvaultCredential,
} from '../src/index'

describe('ActionSpec', () => {
  it('parses a valid github action', () => {
    const spec = ActionSpec.parse({
      name: 'github.get_authenticated_user',
      provider: 'github',
      description: 'Get the authenticated user',
      providerHosts: ['api.github.com'],
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      request: { method: 'GET', urlTemplate: 'https://api.github.com/user' },
      normalize: { login: 'login', id: 'id' },
    })
    expect(spec.provider).toBe('github')
    expect(spec.providerHosts).toContain('api.github.com')
  })

  it('rejects a malformed action name', () => {
    const bad = ActionSpec.safeParse({
      name: 'NotAValidName',
      provider: 'github',
      description: 'x',
      providerHosts: ['api.github.com'],
      inputSchema: {},
      outputSchema: {},
      request: { method: 'GET', urlTemplate: 'https://api.github.com/user' },
      normalize: {},
    })
    expect(bad.success).toBe(false)
  })

  it('requires at least one provider host (SSRF allowlist)', () => {
    const bad = ActionSpec.safeParse({
      name: 'github.create_issue',
      provider: 'github',
      description: 'x',
      providerHosts: [],
      inputSchema: {},
      outputSchema: {},
      request: { method: 'POST', urlTemplate: 'https://api.github.com/repos/{owner}/{repo}/issues' },
      normalize: {},
    })
    expect(bad.success).toBe(false)
  })
})

describe('errors', () => {
  it('maps every error code to a stable 4xx/5xx status', () => {
    for (const code of ErrorCode.options) {
      expect(statusForCode(code)).toBeGreaterThanOrEqual(400)
    }
    expect(statusForCode('not_connected')).toBe(409)
    expect(statusForCode('rate_limited')).toBe(429)
    expect(statusForCode('upstream_timeout')).toBe(504)
  })

  it('omits details when not provided (no undefined leakage)', () => {
    expect(conduitError('internal', 'boom')).toEqual({ code: 'internal', message: 'boom' })
    expect(conduitError('validation_error', 'bad', { field: 'title' })).toEqual({
      code: 'validation_error',
      message: 'bad',
      details: { field: 'title' },
    })
  })
})

describe('ExecuteRequest', () => {
  it('accepts a well-formed request', () => {
    const r = ExecuteRequest.safeParse({
      action: 'github.create_issue',
      endUserId: 'alice',
      args: { title: 'hi' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects a missing end-user', () => {
    const r = ExecuteRequest.safeParse({ action: 'github.create_issue', args: {} })
    expect(r.success).toBe(false)
  })
})

describe('CredvaultCredential (the pinned credvault contract)', () => {
  it('matches credvault GET /v1/credentials/:provider shape', () => {
    const c = CredvaultCredential.parse({
      access_token: 'gho_x',
      token_type: 'Bearer',
      expires_at: null,
      scopes: ['read:user'],
    })
    expect(c.token_type).toBe('Bearer')
    expect(c.expires_at).toBeNull()
  })
})
