// Shared builders for the identity tests. IdentityService is exercised over @conduit/store's
// InMemoryTenantStore (the reference TenantStore semantics), so no fakes are needed here.

import { TenantId } from '@conduit/contracts'

export const tenantId = (s = 'acme') => TenantId.parse(s)
