/**
 * Configuration for conduit acting as its own OAuth 2.1 Authorization Server for the MCP Resource
 * Server (MCP auth spec 2025-06-18). The container builds this from env; the AS logic takes it
 * explicitly so it is testable. `resource` is the canonical MCP server URI that every issued access
 * token is audience-bound to (RFC 8707) and that the MCP route validates on each request.
 */
export interface OAuthConfig {
  readonly issuer: string
  readonly resource: string
  readonly signingSecret: Uint8Array
  readonly accessTokenTtlSeconds: number
}
