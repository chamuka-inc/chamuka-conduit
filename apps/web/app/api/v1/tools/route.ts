import { getServices } from '@/lib/server/container'
import { handleListTools } from '@/lib/server/gateway'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Promise<Response> {
  return handleListTools(getServices(), request)
}
