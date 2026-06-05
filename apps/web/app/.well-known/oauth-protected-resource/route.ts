import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler'
import { getOAuthConfig } from '@/lib/server/container'

// RFC 9728 Protected Resource Metadata — served by the MCP server (the RS), pointing MCP clients at
// conduit's authorization server. The MCP route's 401s reference this document via WWW-Authenticate.

export const dynamic = 'force-dynamic'

export function GET(request: Request): Promise<Response> {
  const handler = protectedResourceHandler({ authServerUrls: [getOAuthConfig().issuer] })
  return Promise.resolve(handler(request))
}

export const OPTIONS = metadataCorsOptionsRequestHandler()
