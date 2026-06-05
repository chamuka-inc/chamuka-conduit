// FR-4b: validate an action's input arguments against its declared inputSchema (JSON Schema, draft
// 2020-12) before any token is brokered or socket opened. A failure is the closed-taxonomy
// `validation_error`, never a thrown exception — the Executor only ever returns a Result.

import Ajv from 'ajv/dist/2020'
import type { ValidateFunction } from 'ajv'
import type { ActionSpec, JsonSchema, Result } from '@conduit/contracts'
import { conduitError, err, ok } from '@conduit/contracts'

/** One reported schema violation, reduced to a path + message (never echoes secret arg values). */
interface ArgError {
  readonly path: string
  readonly message: string
}

/** Ajv reports a violation at the document root with an empty instancePath; label it for readers. */
const ROOT_PATH = '(root)'

/**
 * Compiles each action's inputSchema once (cached by schema identity) and validates args against it.
 * The catalog already proved every inputSchema compiles at load (FR-1); compilation here cannot fail
 * for a catalogued action, so this never throws on well-formed input.
 */
export class ArgsValidator {
  readonly #ajv = new Ajv({ strict: true, allErrors: true })
  readonly #compiled = new WeakMap<JsonSchema, ValidateFunction>()

  validate(spec: ActionSpec, args: Record<string, unknown>): Result<void> {
    const validate = this.#validatorFor(spec.inputSchema)
    if (validate(args)) return ok(undefined)
    return err(
      conduitError('validation_error', `arguments for "${spec.name}" failed schema validation`, {
        errors: toArgErrors(validate.errors),
      }),
    )
  }

  #validatorFor(schema: JsonSchema): ValidateFunction {
    const cached = this.#compiled.get(schema)
    if (cached !== undefined) return cached
    const validate = this.#ajv.compile(schema)
    this.#compiled.set(schema, validate)
    return validate
  }
}

function toArgErrors(errors: ValidateFunction['errors']): ArgError[] {
  if (errors === null || errors === undefined) return []
  return errors.map((e) => ({
    path: e.instancePath === '' ? ROOT_PATH : e.instancePath,
    message: e.message ?? 'invalid',
  }))
}
