import { z } from 'zod'
import Ajv from 'ajv/dist/2020'
import type { ActionCatalog, ActionName, ActionSpec } from '@conduit/contracts'
import { ActionSpec as ActionSpecSchema } from '@conduit/contracts'
import { InMemoryCatalog } from './catalog'
import { CatalogError } from './errors'
import { assertPlaceholdersDeclared, assertValidSchemas } from './validate'

const ActionArray = z.array(ActionSpecSchema)

export interface LoadOptions {
  /** Actions layered over the base catalog; an override replaces a base action of the same name. */
  readonly overrides?: unknown
}

/**
 * Validate and load an action catalog, failing fast (FR-1) on any defect: a structurally invalid
 * spec, an uncompilable JSON Schema, a duplicate name within a layer, or a request placeholder
 * that references an undeclared input property. Overrides are validated by the same rules and
 * merged by name (override wins, base order preserved).
 */
export function loadCatalog(source: unknown, options: LoadOptions = {}): ActionCatalog {
  const ajv = new Ajv({ strict: true })
  const base = loadLayer(source, 'catalog', ajv)
  const overrides = options.overrides === undefined ? [] : loadLayer(options.overrides, 'override', ajv)
  return new InMemoryCatalog(mergeLayers(base, overrides))
}

/** Override wins on name collision; base insertion order is preserved. */
function mergeLayers(
  base: readonly ActionSpec[],
  overrides: readonly ActionSpec[],
): readonly ActionSpec[] {
  const byName = new Map<ActionName, ActionSpec>()
  for (const spec of base) byName.set(spec.name, spec)
  for (const spec of overrides) byName.set(spec.name, spec)
  return [...byName.values()]
}

function loadLayer(source: unknown, label: string, ajv: Ajv): readonly ActionSpec[] {
  const parsed = ActionArray.safeParse(source)
  if (!parsed.success) {
    throw new CatalogError(`${label} is not a valid action array: ${parsed.error.message}`, {
      cause: parsed.error,
    })
  }
  assertNoDuplicates(parsed.data, label)
  for (const spec of parsed.data) {
    assertValidSchemas(ajv, spec)
    assertPlaceholdersDeclared(spec)
  }
  return parsed.data
}

function assertNoDuplicates(specs: readonly ActionSpec[], label: string): void {
  const seen = new Set<ActionName>()
  for (const spec of specs) {
    if (seen.has(spec.name)) {
      throw new CatalogError(`${label} contains duplicate action "${spec.name}"`)
    }
    seen.add(spec.name)
  }
}
