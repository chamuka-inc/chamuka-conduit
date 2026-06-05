import { getOAuthConfig, getOAuthStore } from '@/lib/server/container'
import { handleToken } from '@/lib/server/oauth/endpoints'

export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return handleToken({ store: getOAuthStore(), config: getOAuthConfig() }, request)
}
