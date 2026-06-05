import { checkReady } from '@/lib/server/container'

// Readiness probe (NFR-OPS): 200 only when conduit can actually broker — credvault configured and
// the store reachable. Distinct from /healthz (liveness), which ignores dependencies.

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const ready = await checkReady()
  return Response.json({ status: ready ? 'ready' : 'not_ready' }, { status: ready ? 200 : 503 })
}
