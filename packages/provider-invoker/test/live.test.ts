import { describe, it, expect } from 'vitest'
import type { AccessToken } from '@conduit/contracts'
import { resolveLiveEnv } from '@conduit/test-support'
import { HttpProviderInvoker, renderRequest } from '../src/index'
import { spec, token } from './fixtures'

// Live acceptance (PLAN module 4, FR-11) against real HTTP. This is the one path the unit fakes
// can't cover: render an ActionSpec + args + a real token into a request, SSRF-validate it, and
// call api.github.com. Gated on env — run it with
//   CONDUIT_CREDVAULT_URL=http://localhost:8000 CONDUIT_TENANT_KEY_FILE=/path/to/tenant_key.txt pnpm test
// (or pass the key value via CONDUIT_CREDVAULT_TENANT_KEY). Without the env it skips, so the offline
// verify stays green. A live GitHub connection exists for credvault tenant verify-acme, end-user
// alice — used here only to obtain a real provider token.
const { baseUrl, tenantKey, hasCredvault } = resolveLiveEnv()
const live = hasCredvault ? describe : describe.skip

/** Obtain a real provider token from the running credvault (alice/github), via its HTTP API. */
async function resolveGithubToken(tenantKey: string): Promise<AccessToken> {
  const url = new URL('/v1/credentials/github', baseUrl)
  url.searchParams.set('external_user_id', 'alice')
  const response = await fetch(url, { headers: { authorization: `Bearer ${tenantKey}` } })
  if (response.status !== 200) {
    throw new Error(`credvault did not broker a github token (status ${response.status})`)
  }
  const body = (await response.json()) as {
    access_token: string
    token_type: string
    expires_at: string | null
    scopes: string[]
  }
  return {
    accessToken: body.access_token,
    tokenType: body.token_type,
    expiresAt: body.expires_at,
    scopes: body.scopes,
  }
}

live('@conduit/provider-invoker live acceptance against real HTTP', () => {
  const invoker = new HttpProviderInvoker()

  it('renders github.get_authenticated_user, SSRF-validates it, and calls api.github.com (FR-11)', async () => {
    const githubToken = await resolveGithubToken(tenantKey)
    const s = spec({
      providerHosts: ['api.github.com'],
      request: {
        method: 'GET',
        urlTemplate: 'https://api.github.com/user',
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      },
    })

    const rendered = renderRequest(s, {})
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return

    const result = await invoker.call(s, rendered.value, githubToken)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const user = result.value as { login?: unknown; id?: unknown }
      expect(typeof user.login).toBe('string')
      expect(typeof user.id).toBe('number')
    }
  })

  it('fails closed for an internal (cloud-metadata) host even when allowlisted', async () => {
    const s = spec({
      providerHosts: ['169.254.169.254'],
      request: { method: 'GET', urlTemplate: 'https://169.254.169.254/latest/meta-data/' },
    })
    const rendered = renderRequest(s, {})
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return

    const result = await invoker.call(s, rendered.value, token())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('internal')
  })

  it('fails closed for a host that is not on the action allowlist', async () => {
    const s = spec({
      providerHosts: ['api.github.com'],
      request: { method: 'GET', urlTemplate: 'https://example.com/' },
    })
    const rendered = renderRequest(s, {})
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return

    const result = await invoker.call(s, rendered.value, token())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('internal')
  })
})
