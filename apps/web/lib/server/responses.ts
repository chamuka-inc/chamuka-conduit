// Shared HTTP helpers for the surfaces: bearer-token extraction and the JSON error envelope. The
// execution error taxonomy maps to status through @conduit/contracts' statusForCode (the single
// place codes become statuses, FR-5); 401 is a surface-level credential failure outside that taxonomy.

import { statusForCode } from '@conduit/contracts'
import type { ConduitError } from '@conduit/contracts'

const BEARER_PREFIX = 'Bearer '

/** The bearer token from the Authorization header, or null when absent or not a bearer credential. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null || !header.startsWith(BEARER_PREFIX)) return null
  const token = header.slice(BEARER_PREFIX.length).trim()
  return token === '' ? null : token
}

/** Map a typed ConduitError onto its HTTP status with a stable `{ error }` JSON body. */
export function errorResponse(error: ConduitError): Response {
  return Response.json({ error }, { status: statusForCode(error.code) })
}

/** 401 for a missing or unrecognized API key — authentication is a surface concern, not an outcome. */
export function unauthorized(message: string): Response {
  return Response.json({ error: { code: 'unauthorized', message } }, { status: 401 })
}
