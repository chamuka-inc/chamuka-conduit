import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ActionName, EndUserId, IdempotencyKey, TenantId } from '@conduit/contracts'
import type { ExecuteRequest, TenantPrincipal } from '@conduit/contracts'
import { loadSeedCatalog } from '@conduit/catalog'
import { CredvaultClient } from '@conduit/credvault-client'
import { HttpProviderInvoker } from '@conduit/provider-invoker'
import { InMemoryAuditSink, InMemoryIdempotencyStore } from '@conduit/store'
import { Executor } from '../src/index'

// Live acceptance (PLAN module 6). The whole execution pipeline, end-to-end against real peers: the
// real CredvaultClient brokers a github token for alice from the running credvault, and the real
// HttpProviderInvoker calls api.github.com — wired through the real seed catalog and store. This is
// the one path no fake can cover: a real token brokered and a real provider response normalized into
// the {data,raw} envelope. Gated on env so the offline verify stays green; run it with
//   CONDUIT_CREDVAULT_URL=http://localhost:8000 pnpm test
// (the credvault tenant key is read from ../secrets/tenant_key.txt, or CONDUIT_TENANT_KEY_FILE). A
// live GitHub connection exists for credvault tenant verify-acme, end-user alice.
const baseUrl = process.env.CONDUIT_CREDVAULT_URL ?? ''
const keyFile =
  process.env.CONDUIT_TENANT_KEY_FILE ?? resolve(process.cwd(), '..', 'secrets', 'tenant_key.txt')
const canRun = baseUrl !== '' && existsSync(keyFile)
const live = canRun ? describe : describe.skip

const CREDVAULT_TENANT_REF = 'verify-acme'

live('@conduit/core live acceptance — full pipeline against real credvault + GitHub', () => {
  const tenantKey = canRun ? readFileSync(keyFile, 'utf8').trim() : ''

  const principal: TenantPrincipal = {
    tenantId: TenantId.parse('conduit-verify'),
    credvaultTenantRef: CREDVAULT_TENANT_REF,
  }

  function executor(audit: InMemoryAuditSink, idempotency: InMemoryIdempotencyStore): Executor {
    return new Executor({
      catalog: loadSeedCatalog(),
      tokenResolver: new CredvaultClient({ baseUrl, tenantKeyFor: () => tenantKey }),
      invoker: new HttpProviderInvoker(),
      audit,
      idempotency,
    })
  }

  const getAliceUser = (overrides: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
    action: ActionName.parse('github.get_authenticated_user'),
    endUserId: EndUserId.parse('alice'),
    args: {},
    ...overrides,
  })

  it('executes github.get_authenticated_user for alice and returns a normalized {data,raw}', async () => {
    const audit = new InMemoryAuditSink()
    const result = await executor(audit, new InMemoryIdempotencyStore()).execute(
      principal,
      getAliceUser(),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      const data = result.value.data as { login?: unknown; id?: unknown; htmlUrl?: unknown }
      expect(typeof data.login).toBe('string')
      expect(typeof data.id).toBe('number')
      expect(typeof data.htmlUrl).toBe('string')
      // raw is the untouched provider response (the escape hatch), so it carries snake_case keys.
      const raw = result.value.raw as { login?: unknown; html_url?: unknown }
      expect(typeof raw.login).toBe('string')
      expect(typeof raw.html_url).toBe('string')
    }
    expect(audit.entries[0]?.outcome).toBe('ok')
    expect(audit.entries[0]?.action).toBe(ActionName.parse('github.get_authenticated_user'))
  })

  it('replays the same idempotency key from the store without a second provider call', async () => {
    const exec = executor(new InMemoryAuditSink(), new InMemoryIdempotencyStore())
    const request = getAliceUser({ idempotencyKey: IdempotencyKey.parse('live-idem-1') })

    const first = await exec.execute(principal, request)
    const second = await exec.execute(principal, request)

    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
  })
})
