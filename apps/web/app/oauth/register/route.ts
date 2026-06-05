import { getOAuthStore } from '@/lib/server/container'
import { handleRegister } from '@/lib/server/oauth/endpoints'

export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return handleRegister({ store: getOAuthStore() }, request)
}
