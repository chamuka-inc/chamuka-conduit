import { describe, it, expect } from 'vitest'
import { ActionName } from '@conduit/contracts'
import { loadCatalog, CatalogError } from '../src/index'
import { validRawAction } from './fixtures'

describe('loadCatalog — happy path', () => {
  it('loads a valid action and resolves it by name', () => {
    const catalog = loadCatalog([validRawAction()])
    const spec = catalog.get(ActionName.parse('github.create_issue'))
    expect(spec?.provider).toBe('github')
    expect(spec?.request.method).toBe('POST')
  })

  it('lists every loaded action', () => {
    const catalog = loadCatalog([validRawAction()])
    expect(catalog.list()).toHaveLength(1)
  })

  it('returns undefined for an unknown action', () => {
    const catalog = loadCatalog([validRawAction()])
    expect(catalog.get(ActionName.parse('github.unknown'))).toBeUndefined()
  })
})

describe('loadCatalog — fail-fast at load (FR-1)', () => {
  it('rejects a structurally malformed action (bad action name)', () => {
    const bad = { ...validRawAction(), name: 'NotAValidName' }
    expect(() => loadCatalog([bad])).toThrow(CatalogError)
  })

  it('rejects an action whose inputSchema is not valid JSON Schema', () => {
    const bad = { ...validRawAction(), inputSchema: { type: 'not-a-real-type' } }
    expect(() => loadCatalog([bad])).toThrow(CatalogError)
  })

  it('rejects duplicate action names', () => {
    expect(() => loadCatalog([validRawAction(), validRawAction()])).toThrow(CatalogError)
  })

  it('rejects a request placeholder that references an undeclared input property', () => {
    const bad = validRawAction()
    const request = bad.request as Record<string, unknown>
    request.urlTemplate = 'https://api.github.com/repos/{owner}/{repo}/issues/{undeclared}'
    expect(() => loadCatalog([bad])).toThrow(CatalogError)
  })

  it('rejects a non-array source', () => {
    expect(() => loadCatalog({ not: 'an array' })).toThrow(CatalogError)
  })
})

describe('loadCatalog — runtime overrides', () => {
  it('replaces a base action with an override of the same name', () => {
    const overridden = { ...validRawAction(), description: 'Overridden description.' }
    const catalog = loadCatalog([validRawAction()], { overrides: [overridden] })
    expect(catalog.list()).toHaveLength(1)
    expect(catalog.get(ActionName.parse('github.create_issue'))?.description).toBe(
      'Overridden description.',
    )
  })

  it('adds a new action from the override layer', () => {
    const added = { ...validRawAction(), name: 'github.get_authenticated_user', request: { method: 'GET', urlTemplate: 'https://api.github.com/user' }, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, normalize: { login: 'login' } }
    const catalog = loadCatalog([validRawAction()], { overrides: [added] })
    expect(catalog.list()).toHaveLength(2)
  })

  it('rejects a malformed override (fail-fast applies to the override layer too)', () => {
    const bad = { ...validRawAction(), name: 'BAD' }
    expect(() => loadCatalog([validRawAction()], { overrides: [bad] })).toThrow(CatalogError)
  })
})
