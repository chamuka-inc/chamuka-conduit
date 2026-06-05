// The pure projection step (FD-3): map a provider's raw JSON response onto the action's declared
// output fields using its NormalizeMapping (output field -> dotted path into raw). Produces the
// `data` half of the {data,raw} envelope; the Executor attaches `raw`. No I/O, total (never throws):
// a path that runs off the end of the data yields `undefined` for that field.

import type { NormalizeMapping } from '@conduit/contracts'

/**
 * An empty mapping means "no projection" — the raw response is the data (e.g. list endpoints whose
 * output schema is an array). Otherwise each field is read from its dotted path into `raw`.
 */
export function normalize(mapping: NormalizeMapping, raw: unknown): unknown {
  if (Object.keys(mapping).length === 0) return raw
  const data: Record<string, unknown> = {}
  for (const [field, path] of Object.entries(mapping)) {
    data[field] = readPath(raw, path)
  }
  return data
}

/** Walk a dotted path into a JSON value; return undefined as soon as a segment has no object to read. */
function readPath(value: unknown, path: string): unknown {
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = Reflect.get(current, segment)
  }
  return current
}
