import { describe, it, expect } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import { ActionSpec, ActionName } from '@conduit/contracts'
import { loadCatalog, loadSeedCatalog, toToolDefinitions, CatalogError } from '../src/index'
import rawSeed from '../src/seed/github.json'

// Live acceptance — PLAN module 1. The catalog has no runtime service peer; its real peer is the
// seed catalog data shipped on disk, loaded through the project's actual runtime. These assertions
// encode the module's acceptance criterion verbatim against that real artifact (no fixtures).
describe('seed catalog — live acceptance', () => {
  const catalog = loadSeedCatalog()

  it('loads the real seed: the three GitHub actions', () => {
    expect(
      catalog
        .list()
        .map((s) => s.name)
        .sort(),
    ).toEqual(['github.create_issue', 'github.get_authenticated_user', 'github.list_repositories'])
  })

  it('get("github.create_issue") returns a valid ActionSpec', () => {
    const spec = catalog.get(ActionName.parse('github.create_issue'))
    expect(spec).toBeDefined()
    expect(() => ActionSpec.parse(spec)).not.toThrow()
  })

  it('every action targets only the GitHub API host (SSRF allowlist, FR-11)', () => {
    for (const spec of catalog.list()) {
      expect(spec.providerHosts).toEqual(['api.github.com'])
    }
  })

  it('list() projects to tool defs whose inputSchema is valid JSON Schema (FR-3)', () => {
    const ajv = new Ajv2020({ strict: true })
    for (const def of toToolDefinitions(catalog)) {
      expect(() => ajv.compile(def.inputSchema)).not.toThrow()
    }
  })

  it('rejects a malformed action mixed into the real seed (fail-fast, FR-1)', () => {
    const malformed = { ...rawSeed[0], name: 'INVALID NAME' }
    expect(() => loadCatalog([...rawSeed, malformed])).toThrow(CatalogError)
  })
})
