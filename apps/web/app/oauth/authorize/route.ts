import { getOAuthConfig, getOAuthStore, getServices } from '@/lib/server/container'
import { handleAuthorize } from '@/lib/server/oauth/endpoints'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Promise<Response> {
  return handleAuthorize(
    { store: getOAuthStore(), identity: getServices().identity, config: getOAuthConfig() },
    request,
  )
}
