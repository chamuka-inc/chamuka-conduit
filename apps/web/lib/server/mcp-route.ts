// Wires the MCP method logic (lib/server/mcp) onto the streamable-HTTP transport via mcp-handler,
// guarded by conduit's OAuth 2.1 bearer auth. verifyToken validates the audience-bound access token
// (lib/server/oauth/tokens) and surfaces the bound (tenant, end-user) identity as AuthInfo.extra;
// the tools/call handler reconstructs that identity and never trusts a tenant from the request.
// Stateless streamable HTTP (POST-only, no redis): a fresh server is built per request.

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { TenantId } from '@conduit/contracts'
import type { ConduitServices } from './services'
import type { OAuthConfig } from './oauth/config'
import { verifyAccessToken } from './oauth/tokens'
import { callToolResult, listToolsResult, type McpAuthContext } from './mcp'

const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

/** Build the OAuth-guarded MCP streamable-HTTP handler for the given services + AS config. */
export function buildMcpHandler(
  services: ConduitServices,
  config: OAuthConfig,
): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(
    (server) => {
      server.server.setRequestHandler(ListToolsRequestSchema, () => listToolsResult(services.catalog))
      server.server.setRequestHandler(
        CallToolRequestSchema,
        (request, extra): Promise<CallToolResult> => {
          const context = contextFromAuthInfo(extra.authInfo)
          if (context === null) {
            return Promise.resolve({
              content: [{ type: 'text', text: 'internal: the session is not bound to a tenant' }],
              isError: true,
            })
          }
          return callToolResult(services, context, request.params.name, request.params.arguments ?? {})
        },
      )
    },
    { serverInfo: { name: 'conduit', version: '0.1.0' }, capabilities: { tools: {} } },
    { basePath: '/api', disableSse: true },
  )

  return withMcpAuth(handler, (_request, bearerToken) => verify(config, bearerToken), {
    required: true,
    resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH,
    resourceUrl: config.resource,
  })
}

/** Validate the bearer access token into the AuthInfo mcp-handler expects, or undefined → 401. */
async function verify(config: OAuthConfig, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (bearerToken === undefined) return undefined
  const verified = await verifyAccessToken(config, bearerToken)
  if (verified === null) return undefined
  return {
    token: bearerToken,
    clientId: verified.clientId,
    scopes: verified.scopes,
    expiresAt: verified.expiresAt,
    resource: new URL(config.resource),
    extra: {
      tenantId: verified.claims.tenantId,
      credvaultTenantRef: verified.claims.credvaultTenantRef,
      endUserId: verified.claims.endUserId,
    },
  }
}

/** Reconstruct the conduit auth context from the token's claims carried on AuthInfo.extra. */
function contextFromAuthInfo(authInfo: AuthInfo | undefined): McpAuthContext | null {
  const extra = authInfo?.extra
  if (extra === undefined) return null
  const { tenantId, credvaultTenantRef, endUserId } = extra
  if (typeof tenantId !== 'string' || typeof credvaultTenantRef !== 'string' || typeof endUserId !== 'string') {
    return null
  }
  return { principal: { tenantId: TenantId.parse(tenantId), credvaultTenantRef }, endUserId }
}
