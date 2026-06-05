// The REST Gateway handlers (SAD §Gateway, FR-3/4/5). Each authenticates the caller to a tenant via
// @conduit/identity, then makes exactly one Executor (or Catalog) call and maps the typed Result onto
// HTTP. They hold no business logic and invent no business errors — the closed taxonomy passes through
// statusForCode. Framework-agnostic (Web Request/Response + injected services), so they unit-test
// without Next and the route handlers stay one-liners.

import { ExecuteRequest, conduitError, err, ok } from '@conduit/contracts'
import type { Result, TenantPrincipal } from '@conduit/contracts'
import { toToolDefinitions } from '@conduit/catalog'
import type { ConduitServices } from './services'
import { bearerToken, errorResponse, unauthorized } from './responses'

/** Resolve the caller's API key to its tenant principal (server-side, NFR-SEC-1), or null. */
function authenticate(services: ConduitServices, request: Request): Promise<TenantPrincipal | null> {
  const token = bearerToken(request)
  if (token === null) return Promise.resolve(null)
  return services.identity.verify(token)
}

/** GET /api/v1/tools — the catalog's tool definitions for an authenticated caller (FR-3). */
export async function handleListTools(
  services: ConduitServices,
  request: Request,
): Promise<Response> {
  const principal = await authenticate(services, request)
  if (principal === null) return unauthorized('a valid conduit API key is required')
  return Response.json({ tools: toToolDefinitions(services.catalog) })
}

/** POST /api/v1/execute — authenticate, validate the envelope, run one action, map Result → HTTP. */
export async function handleExecute(
  services: ConduitServices,
  request: Request,
): Promise<Response> {
  const principal = await authenticate(services, request)
  if (principal === null) return unauthorized('a valid conduit API key is required')

  const parsed = await parseExecuteRequest(request)
  if (!parsed.ok) return errorResponse(parsed.error)

  const result = await services.executor.execute(principal, parsed.value)
  return result.ok ? Response.json(result.value) : errorResponse(result.error)
}

/** Read and validate the execute envelope; a malformed body or shape is a validation_error (FR-5). */
async function parseExecuteRequest(request: Request): Promise<Result<ExecuteRequest>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return err(conduitError('validation_error', 'request body is not valid JSON'))
  }
  const parsed = ExecuteRequest.safeParse(body)
  if (parsed.success) return ok(parsed.data)
  return err(
    conduitError('validation_error', 'request does not match the execute envelope', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((seg) => (typeof seg === 'symbol' ? seg.toString() : `${seg}`)).join('.'),
        message: issue.message,
      })),
    }),
  )
}
