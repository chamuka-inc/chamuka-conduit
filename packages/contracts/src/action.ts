import { z } from 'zod'
import { ActionName } from './ids'

/**
 * A JSON Schema document (Draft 2020-12). Kept permissive at the contract layer; the catalog
 * loader validates structure and uses it both to validate action args and to emit tool
 * definitions for function-calling (FR-1, FR-3).
 */
export const JsonSchema = z.record(z.string(), z.unknown())
export type JsonSchema = z.infer<typeof JsonSchema>

export const HttpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
export type HttpMethod = z.infer<typeof HttpMethod>

/**
 * A request template. String leaves may contain `{arg}` placeholders resolved from the
 * validated action input at execution time (FR-4c). The rendered URL is SSRF-checked against
 * {@link ActionSpec.providerHosts} before any socket opens (FR-11).
 */
export const RequestTemplate = z.object({
  method: HttpMethod,
  urlTemplate: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
})
export type RequestTemplate = z.infer<typeof RequestTemplate>

/**
 * Maps each normalized output field to a dotted path into the provider's raw JSON response
 * (e.g. `{ id: "id", url: "html_url" }`). Produces the `data` half of the envelope (FD-3).
 */
export const NormalizeMapping = z.record(z.string(), z.string())
export type NormalizeMapping = z.infer<typeof NormalizeMapping>

/** A single executable provider operation, defined as data, not code (FD-2, FR-1). */
export const ActionSpec = z.object({
  name: ActionName,
  provider: z.string().min(1),
  description: z.string().min(1),
  /** Allowlist of hosts the rendered request may target (SSRF guard, FR-11). */
  providerHosts: z.array(z.string().min(1)).min(1),
  inputSchema: JsonSchema,
  outputSchema: JsonSchema,
  request: RequestTemplate,
  normalize: NormalizeMapping,
})
export type ActionSpec = z.infer<typeof ActionSpec>
