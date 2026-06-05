// Liveness probe (NFR-OPS): returns 200 as long as the process is serving. It performs no
// dependency checks — readiness (credvault/Postgres reachable) is the separate /readyz probe.

export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json({ status: 'ok' })
}
