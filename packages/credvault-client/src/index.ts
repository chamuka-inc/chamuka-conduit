// @conduit/credvault-client — the TokenResolver impl (FR-6). Calls credvault's token-brokering
// API (GET /v1/credentials/:provider) for a valid provider token at execution time, mapping its
// responses onto AccessToken / the closed ConduitError taxonomy. Holds no credentials itself; the
// credvault tenant key is injected per request via tenantKeyFor. Depends only on @conduit/contracts.

export { CredvaultClient } from './client'
export type { CredvaultClientOptions, FetchLike, HttpResponse } from './client'
