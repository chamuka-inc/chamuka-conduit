import { describe, it, expect } from 'vitest'
import { InMemoryTenantStore } from '@conduit/store'
import type { TenantPrincipal } from '@conduit/contracts'
import { IdentityService } from '../src/index'
import { tenantId } from './fixtures'

// E2E against the real dependency (the store's in-memory TenantStore). Identity's contract consumer
// is the gateway surface (apps/web, module 7): it authenticates a request by its bearer conduit API
// key through Identity and derives the tenant SERVER-SIDE, never from the request. A mock gateway
// exercises that whole path before the real surface exists, proving the seam (FR-9, NFR-SEC-1).

interface GatewayResponse {
  readonly status: number
  readonly principal?: TenantPrincipal
}

class FakeGateway {
  constructor(private readonly identity: IdentityService) {}

  async handle(authorization: string | undefined): Promise<GatewayResponse> {
    const prefix = 'Bearer '
    const bearer = authorization?.startsWith(prefix) ? authorization.slice(prefix.length) : ''
    const principal = await this.identity.verify(bearer)
    return principal === null ? { status: 401 } : { status: 200, principal }
  }
}

describe('Gateway consumer: authenticate by conduit API key through Identity', () => {
  it('authorizes an issued key and resolves the tenant server-side', async () => {
    const identity = new IdentityService(new InMemoryTenantStore())
    const issued = await identity.issue({ tenantId: tenantId('acme'), credvaultTenantRef: 'verify-acme' })
    const gateway = new FakeGateway(identity)

    const res = await gateway.handle(`Bearer ${issued.apiKey}`)
    expect(res.status).toBe(200)
    expect(res.principal).toEqual(issued.principal)
  })

  it('rejects a missing or unknown key with 401 (NFR-SEC-1)', async () => {
    const identity = new IdentityService(new InMemoryTenantStore())
    await identity.issue({ tenantId: tenantId('acme'), credvaultTenantRef: 'verify-acme' })
    const gateway = new FakeGateway(identity)

    expect((await gateway.handle(undefined)).status).toBe(401)
    expect((await gateway.handle('Bearer cdt_not-a-real-key')).status).toBe(401)
  })
})
