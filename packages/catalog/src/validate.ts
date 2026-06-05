import type Ajv from 'ajv/dist/2020'
import type { ActionSpec, JsonSchema, RequestTemplate } from '@conduit/contracts'
import { CatalogError } from './errors'

const PLACEHOLDER = /\{([^{}]+)\}/g

/** Compile both schemas so a malformed JSON Schema is rejected at load, not at first request. */
export function assertValidSchemas(ajv: Ajv, spec: ActionSpec): void {
  try {
    ajv.compile(spec.inputSchema)
    ajv.compile(spec.outputSchema)
  } catch (cause) {
    throw new CatalogError(`action "${spec.name}" has an invalid JSON Schema`, { cause })
  }
}

/**
 * FR-1 invariant: every `{arg}` placeholder in the request template must reference a property
 * declared in the action's input schema, so a typo cannot silently render to an empty value at
 * execution time.
 */
export function assertPlaceholdersDeclared(spec: ActionSpec): void {
  const declared = declaredInputProperties(spec.inputSchema)
  for (const used of requestPlaceholders(spec.request)) {
    if (!declared.has(used)) {
      throw new CatalogError(
        `action "${spec.name}" references undeclared input property "${used}" in its request template`,
      )
    }
  }
}

function declaredInputProperties(schema: JsonSchema): ReadonlySet<string> {
  const properties = schema['properties']
  if (properties === null || typeof properties !== 'object') return new Set()
  return new Set(Object.keys(properties))
}

function requestPlaceholders(request: RequestTemplate): ReadonlySet<string> {
  const found = new Set<string>()
  collectPlaceholders(request.urlTemplate, found)
  for (const value of Object.values(request.headers ?? {})) collectPlaceholders(value, found)
  for (const value of Object.values(request.query ?? {})) collectPlaceholders(value, found)
  if (request.body !== undefined) collectPlaceholders(request.body, found)
  return found
}

function collectPlaceholders(value: unknown, found: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(PLACEHOLDER)) {
      const name = match[1]
      if (name !== undefined) found.add(name)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const element of value) collectPlaceholders(element, found)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const element of Object.values(value)) collectPlaceholders(element, found)
  }
}
