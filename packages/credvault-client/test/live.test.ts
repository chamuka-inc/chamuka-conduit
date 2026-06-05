import { describe, it, expect } from 'vitest'
import { resolveLiveEnv } from '@conduit/test-support'
import { CredvaultClient } from '../src/index'
import { principal, endUser } from './fixtures'

// Live acceptance (PLAN module 3) against the running credvault. This is the one path the unit
// fakes can't cover: the default global fetch against real HTTP. Gated on env — run it with
//   CONDUIT_CREDVAULT_URL=http://localhost:8000 CONDUIT_TENANT_KEY_FILE=/path/to/tenant_key.txt pnpm test
// (or pass the key value via CONDUIT_CREDVAULT_TENANT_KEY). Without the env it skips, so the offline
// verify stays green. A live GitHub connection exists for credvault tenant verify-acme, end-user alice.
const { baseUrl, tenantKey, hasCredvault } = resolveLiveEnv()
const live = hasCredvault ? describe : describe.skip

live('@conduit/credvault-client live acceptance against the running credvault', () => {
  const client = new CredvaultClient({
    baseUrl,
    tenantKeyFor: (ref) => (ref === 'verify-acme' ? tenantKey : undefined),
  })

  it('resolves a connected end-user (alice/github) to a usable AccessToken (FR-6)', async () => {
    const result = await client.resolve(principal('verify-acme'), endUser('alice'), 'github')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.accessToken.length).toBeGreaterThan(0)
      expect(result.value.tokenType).toBe('Bearer')
      expect(Array.isArray(result.value.scopes)).toBe(true)
    }
  })

  it('maps an unconnected end-user to a not_connected ConduitError (404)', async () => {
    const result = await client.resolve(principal('verify-acme'), endUser('nobody-xyz'), 'github')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_connected')
  })
})
