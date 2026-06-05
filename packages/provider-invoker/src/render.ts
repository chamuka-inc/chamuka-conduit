// The pure render step (FR-4c): an ActionSpec request template + validated args -> RenderedRequest.
// String leaves may carry `{arg}` placeholders. No I/O, and never the token — the invoker injects
// that at call time. Reused by the Executor (module 6).

import type { Result, ActionSpec, RenderedRequest } from '@conduit/contracts'
import { ok, err, conduitError } from '@conduit/contracts'

/** Thrown internally when a template references an arg the caller did not supply. */
class MissingArgError extends Error {
  constructor(readonly key: string) {
    super(`template references {${key}} but no such arg was provided`)
  }
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g

/** Replace `{key}` tokens in a string from args, applying `encode` to each substituted value. */
function substitute(
  template: string,
  args: Record<string, unknown>,
  encode: (value: string) => string,
): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    if (!(key in args)) throw new MissingArgError(key)
    return encode(String(args[key]))
  })
}

const identity = (value: string) => value

/** Recursively substitute placeholders in the string leaves of a JSON-shaped body. */
function substituteDeep(value: unknown, args: Record<string, unknown>): unknown {
  if (typeof value === 'string') return substitute(value, args, identity)
  if (Array.isArray(value)) return value.map((item) => substituteDeep(item, args))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substituteDeep(v, args)]),
    )
  }
  return value
}

export function renderRequest(
  spec: ActionSpec,
  args: Record<string, unknown>,
): Result<RenderedRequest> {
  const template = spec.request
  try {
    // Path values are percent-encoded so an arg can never inject extra path/host structure.
    const url = new URL(substitute(template.urlTemplate, args, encodeURIComponent))
    if (template.query) {
      for (const [key, value] of Object.entries(template.query)) {
        url.searchParams.set(key, substitute(value, args, identity))
      }
    }
    const headers: Record<string, string> = {}
    if (template.headers) {
      for (const [key, value] of Object.entries(template.headers)) {
        headers[key] = substitute(value, args, identity)
      }
    }
    const body =
      template.body === undefined ? undefined : substituteDeep(template.body, args)
    return ok({ method: template.method, url: url.toString(), headers, body })
  } catch (error) {
    if (error instanceof MissingArgError) {
      return err(conduitError('validation_error', error.message, { arg: error.key }))
    }
    return err(conduitError('validation_error', 'request template did not render to a valid URL'))
  }
}
