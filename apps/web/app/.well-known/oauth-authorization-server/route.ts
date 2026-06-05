import { getOAuthConfig } from '@/lib/server/container'
import { authorizationServerMetadata } from '@/lib/server/oauth/metadata'

// RFC 8414 Authorization Server Metadata — conduit is its own AS for the MCP resource.

export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json(authorizationServerMetadata(getOAuthConfig()))
}
