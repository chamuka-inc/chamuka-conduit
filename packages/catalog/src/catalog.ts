import type { ActionCatalog, ActionName, ActionSpec } from '@conduit/contracts'

/**
 * In-memory {@link ActionCatalog}: a name→spec index over an already-validated, already-merged
 * set of actions. All validation and base/override merging happens in the loader ({@link
 * loadCatalog}); this type only stores and looks up, so it stays a pure data structure.
 */
export class InMemoryCatalog implements ActionCatalog {
  readonly #byName: ReadonlyMap<ActionName, ActionSpec>

  constructor(specs: readonly ActionSpec[]) {
    const byName = new Map<ActionName, ActionSpec>()
    for (const spec of specs) byName.set(spec.name, spec)
    this.#byName = byName
  }

  get(name: ActionName): ActionSpec | undefined {
    return this.#byName.get(name)
  }

  list(): readonly ActionSpec[] {
    return [...this.#byName.values()]
  }
}
