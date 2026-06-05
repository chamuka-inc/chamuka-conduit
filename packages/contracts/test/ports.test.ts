import { describe, it, expect } from 'vitest'
import type { ActionCatalog } from '../src/index'
import { ActionSpec, ActionName } from '../src/index'

const spec = ActionSpec.parse({
  name: 'github.get_authenticated_user',
  provider: 'github',
  description: 'Get the authenticated user',
  providerHosts: ['api.github.com'],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  request: { method: 'GET', urlTemplate: 'https://api.github.com/user' },
  normalize: { login: 'login' },
})

describe('ActionCatalog port', () => {
  const catalog: ActionCatalog = {
    get: (name) => (name === spec.name ? spec : undefined),
    list: () => [spec],
  }

  it('looks up a known action by name', () => {
    expect(catalog.get(spec.name)?.provider).toBe('github')
  })

  it('returns undefined for an unknown action', () => {
    expect(catalog.get(ActionName.parse('github.unknown'))).toBeUndefined()
  })

  it('lists the actions it holds', () => {
    expect(catalog.list()).toHaveLength(1)
  })
})
