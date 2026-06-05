import { getOAuthConfig, getServices } from '@/lib/server/container'
import { buildMcpHandler } from '@/lib/server/mcp-route'

// The MCP streamable-HTTP endpoint at /api/mcp (mcp-handler's [transport] convention). POST-only by
// design; a fresh, stateless handler is built per request. OAuth-guarded by withMcpAuth inside.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function handle(request: Request): Promise<Response> {
  return buildMcpHandler(getServices(), getOAuthConfig())(request)
}

export { handle as GET, handle as POST }
