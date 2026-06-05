import { describe, it, expect } from 'vitest'
import type { ActionCatalog } from '@conduit/contracts'
import { ActionName } from '@conduit/contracts'
import { loadCatalog } from '../src/index'
import { validRawAction } from './fixtures'

// The loader's product must satisfy the frozen ActionCatalog port (contracts v0.2.0) so the
// Executor and surfaces can consume it through the seam, not the concrete type.
describe('loadCatalog product conforms to the ActionCatalog port', () => {
  const catalog: ActionCatalog = loadCatalog([validRawAction()])

  it('exposes get() typed by the port', () => {
    expect(catalog.get(ActionName.parse('github.create_issue'))?.name).toBe('github.create_issue')
  })

  it('exposes list() returning the held specs', () => {
    const specs = catalog.list()
    expect(specs.map((s) => s.name)).toEqual(['github.create_issue'])
  })
})
