import { describe, it, expect } from 'vitest'
import type { RenderedRequest } from '@conduit/contracts'
import { HttpProviderInvoker } from '../src/index'
import { renderRequest } from '../src/index'
import { spec, token, stubFetch, hangingFetch, failingFetch } from './fixtures'

// Unit specs for the ProviderInvoker port impl (FR-4d, FR-11). The peer is the provider's HTTP API,
// stood in for by an injected FetchLike, so every outcome→Result mapping is pinned here before the
// live gate. call() never throws across the port — failures are err(ConduitError).

function rendered(overrides: Partial<RenderedRequest> = {}): RenderedRequest {
  return {
    method: 'GET',
    url: 'https://api.github.com/user',
    headers: { accept: 'application/vnd.github+json' },
    ...overrides,
  }
}

function invokerReturning(status: number, body: unknown) {
  const stub = stubFetch(status, body)
  return { invoker: new HttpProviderInvoker({ fetch: stub.fetch }), calls: stub.calls }
}

describe('HttpProviderInvoker.call', () => {
  it('returns raw provider JSON on 2xx and injects the token as Authorization', async () => {
    const { invoker, calls } = invokerReturning(200, { login: 'alice', id: 7 })
    const result = await invoker.call(spec(), rendered(), token())

    expect(result).toEqual({ ok: true, value: { login: 'alice', id: 7 } })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url).toBe('https://api.github.com/user')
    expect(calls[0]?.headers.authorization).toBe('Bearer gho_live_token')
    expect(calls[0]?.headers.accept).toBe('application/vnd.github+json')
  })

  it('sends a JSON body with a content-type for write actions', async () => {
    const { invoker, calls } = invokerReturning(201, { ok: true })
    await invoker.call(
      spec(),
      rendered({ method: 'POST', body: { title: 'Bug' } }),
      token(),
    )
    expect(calls[0]?.body).toBe('{"title":"Bug"}')
    expect(calls[0]?.headers['content-type']).toBe('application/json')
  })

  it('fails closed with validation_error and opens no socket for a non-allowlisted host', async () => {
    const { invoker, calls } = invokerReturning(200, {})
    const result = await invoker.call(
      spec({ providerHosts: ['api.github.com'] }),
      rendered({ url: 'https://evil.example.com/user' }),
      token(),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
    expect(calls).toHaveLength(0)
  })

  it('fails closed for an internal IP target even when allowlisted (SSRF)', async () => {
    const { invoker, calls } = invokerReturning(200, {})
    const result = await invoker.call(
      spec({ providerHosts: ['169.254.169.254'] }),
      rendered({ url: 'https://169.254.169.254/latest/meta-data/' }),
      token(),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
    expect(calls).toHaveLength(0)
  })

  it('maps a provider 5xx to provider_error', async () => {
    const { invoker } = invokerReturning(503, { message: 'unavailable' })
    const result = await invoker.call(spec(), rendered(), token())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('provider_error')
  })

  it('maps a provider 4xx to provider_error', async () => {
    const { invoker } = invokerReturning(422, { message: 'unprocessable' })
    const result = await invoker.call(spec(), rendered(), token())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('provider_error')
  })

  it('maps a provider 429 to rate_limited', async () => {
    const { invoker } = invokerReturning(429, { message: 'slow down' })
    const result = await invoker.call(spec(), rendered(), token())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('rate_limited')
  })

  it('maps a slow provider to upstream_timeout', async () => {
    const invoker = new HttpProviderInvoker({ fetch: hangingFetch, timeoutMs: 5 })
    const result = await invoker.call(spec(), rendered(), token())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('upstream_timeout')
  })

  it('maps a transport failure to internal', async () => {
    const invoker = new HttpProviderInvoker({ fetch: failingFetch })
    const result = await invoker.call(spec(), rendered(), token())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('internal')
  })

  it('renders then invokes: the render output is a valid input to call', async () => {
    const { invoker, calls } = invokerReturning(200, { login: 'alice' })
    const r = renderRequest(spec(), {})
    expect(r.ok).toBe(true)
    if (r.ok) {
      const result = await invoker.call(spec(), r.value, token())
      expect(result.ok).toBe(true)
      expect(calls[0]?.url).toBe('https://api.github.com/user')
    }
  })
})
