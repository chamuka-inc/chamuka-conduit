// @conduit/identity — the Identity & Tenancy component (FR-9, NFR-SEC-1). Issues conduit API keys
// for a project mapped to a credvault tenant (returning the key once, storing only its SHA-256
// hash) and verifies a presented key back to its TenantPrincipal, deriving the tenant server-side
// from the hash and never from the request. Backed by @conduit/store's TenantStore.

export { IdentityService } from './identity'
export type { IssueTenantInput, IssuedApiKey } from './identity'
export { generateApiKey, hashApiKey, API_KEY_PREFIX } from './api-key'
