// FR-4a + FR-4e (FD-3): validate a value against one of an action's declared JSON Schemas (draft
// 2020-12), through one compiled-schema engine. Input args are checked before any token is brokered
// or socket opened — a failure is the caller's fault, so `validation_error`. The normalized output
// `data` is checked before it leaves conduit — a failure means conduit's own catalogued output
// contract was not met (never the caller's fault, and there is no upstream status to echo), so it is
// `internal`. Neither path throws: the Executor only ever returns a Result on the closed taxonomy.

import Ajv from 'ajv/dist/2020'
import type { ValidateFunction } from 'ajv'
import type { ActionSpec, ErrorCode, JsonSchema, Result } from '@conduit/contracts'
import { conduitError, err, ok } from '@conduit/contracts'

/** One reported schema violation, reduced to a path + message (never echoes secret values). */
interface SchemaViolation {
  readonly path: string
  readonly message: string
}

/** Ajv reports a root violation with an empty instancePath; label it for readers. */
const ROOT_PATH = '(root)'

/**
 * Compiles each action's input/output schema once (cached by schema identity) and validates a value
 * against it. The catalog already proved every schema compiles at load (FR-1); compilation here cannot
 * fail for a catalogued action, so this never throws on a well-formed schema.
 */
export class SchemaValidator {
  readonly #ajv = new Ajv({ strict: true, allErrors: true })
  readonly #compiled = new WeakMap<JsonSchema, ValidateFunction>()

  /** FR-4a: an action's input arguments must satisfy its inputSchema before any side effect. */
  validateInput(spec: ActionSpec, args: Record<string, unknown>): Result<void> {
    return this.#check(
      spec.inputSchema,
      args,
      'validation_error',
      `arguments for "${spec.name}" failed schema validation`,
    )
  }

  /** FR-4e / FD-3: the normalized `data` must satisfy outputSchema before the envelope is returned. */
  validateOutput(spec: ActionSpec, data: unknown): Result<void> {
    return this.#check(
      spec.outputSchema,
      data,
      'internal',
      `the response for "${spec.name}" did not match its declared output schema`,
    )
  }

  #check(schema: JsonSchema, value: unknown, code: ErrorCode, message: string): Result<void> {
    const validate = this.#validatorFor(schema)
    if (validate(value)) return ok(undefined)
    return err(conduitError(code, message, { errors: toViolations(validate.errors) }))
  }

  #validatorFor(schema: JsonSchema): ValidateFunction {
    const cached = this.#compiled.get(schema)
    if (cached !== undefined) return cached
    const validate = this.#ajv.compile(schema)
    this.#compiled.set(schema, validate)
    return validate
  }
}

function toViolations(errors: ValidateFunction['errors']): SchemaViolation[] {
  if (errors === null || errors === undefined) return []
  return errors.map((e) => ({
    path: e.instancePath === '' ? ROOT_PATH : e.instancePath,
    message: e.message ?? 'invalid',
  }))
}
