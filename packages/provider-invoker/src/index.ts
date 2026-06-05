// @conduit/provider-invoker — the ProviderInvoker impl (FR-4d, FR-11). Turns an ActionSpec template
// + validated args into a RenderedRequest (renderRequest), SSRF-validates the target against the
// action's providerHosts allowlist plus credvault's non-routable-IP rules (validateTarget /
// isGlobalIp, ported from src/providers/mod.rs), then makes a timed, token-authenticated HTTP call
// and maps the outcome onto the closed ConduitError taxonomy. Depends only on @conduit/contracts.

export { HttpProviderInvoker } from './invoker'
export type { HttpProviderInvokerOptions, FetchLike, HttpResponse } from './invoker'
export { renderRequest } from './render'
export { validateTarget, isGlobalIp } from './ssrf'
