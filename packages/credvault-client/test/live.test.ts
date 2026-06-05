import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { CredvaultClient } from '../src/index'
import { principal, endUser } from './fixtures'

// Live acceptance (PLAN module 3) against the running credvault. This is the one path the unit
// fakes can't cover: the default global fetch against real HTTP. Gated on env — run it with
//   CONDUIT_CREDVAULT_URL=http://localhost:8000 pnpm test
// (the tenant key is read from ../secrets/tenant_key.txt, or CONDUIT_TENANT_KEY_FILE). Without the
// env it skips, so the offline verify stays green. A live GitHub connection exists for credvault
// tenant verify-acme, end-user alice.
const baseUrl = process.env.CONDUIT_CREDVAULT_URL ?? ''
const keyFile =
  process.env.CONDUIT_TENANT_KEY_FILE ?? resolve(process.cwd(), '..', 'secrets', 'tenant_key.txt')
const canRun = baseUrl !== '' && existsSync(keyFile)
const live = canRun ? describe : describe.skip

live('@conduit/credvault-client live acceptance against the running credvault', () => {
  const tenantKey = canRun ? readFileSync(keyFile, 'utf8').trim() : ''
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
