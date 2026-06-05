import { getServices } from '@/lib/server/container'
import { handleExecute } from '@/lib/server/gateway'

export const dynamic = 'force-dynamic'

export function POST(request: Request): Promise<Response> {
  return handleExecute(getServices(), request)
}
