import { z } from 'zod'

/** Closed set of failure codes (FR-5). Each maps to a stable HTTP status. */
export const ErrorCode = z.enum([
  'validation_error',
  'not_connected',
  'provider_error',
  'upstream_timeout',
  'rate_limited',
  'internal',
])
export type ErrorCode = z.infer<typeof ErrorCode>

/** The one place error codes become HTTP statuses; both surfaces map through this (FR-5). */
const STATUS_FOR_CODE: Readonly<Record<ErrorCode, number>> = {
  validation_error: 400,
  not_connected: 409,
  provider_error: 502,
  upstream_timeout: 504,
  rate_limited: 429,
  internal: 500,
}

export function statusForCode(code: ErrorCode): number {
  return STATUS_FOR_CODE[code]
}

/** A typed, serializable error. `details` never carries secrets or upstream credential data. */
export const ConduitError = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
})
export type ConduitError = z.infer<typeof ConduitError>

export function conduitError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ConduitError {
  return details === undefined ? { code, message } : { code, message, details }
}
