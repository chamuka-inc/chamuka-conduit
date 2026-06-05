// RFC 8414 Authorization Server Metadata, served at /.well-known/oauth-authorization-server. It
// advertises only what conduit actually implements: the authorization-code grant with mandatory
// PKCE S256, public clients (no client secret), and dynamic client registration.

import type { OAuthConfig } from './config'

export interface AuthorizationServerMetadata {
  readonly issuer: string
  readonly authorization_endpoint: string
  readonly token_endpoint: string
  readonly registration_endpoint: string
  readonly response_types_supported: string[]
  readonly grant_types_supported: string[]
  readonly code_challenge_methods_supported: string[]
  readonly token_endpoint_auth_methods_supported: string[]
  readonly scopes_supported: string[]
}

export const MCP_SCOPE = 'mcp'

export function authorizationServerMetadata(config: OAuthConfig): AuthorizationServerMetadata {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    registration_endpoint: `${config.issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [MCP_SCOPE],
  }
}
