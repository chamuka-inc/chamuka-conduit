import { describe, it, expect } from 'vitest'
import { normalize } from '../src/index'

// normalize is the pure projection step (FD-3): it maps the provider's raw JSON onto the action's
// declared output fields using the NormalizeMapping (output field -> dotted path into raw). It
// produces the `data` half of the {data,raw} envelope; `raw` is attached by the Executor.

describe('normalize', () => {
  it('projects each output field from its dotted path into the raw response', () => {
    const raw = { login: 'alice', id: 7, html_url: 'https://github.com/alice', extra: 'ignored' }
    const data = normalize({ login: 'login', id: 'id', htmlUrl: 'html_url' }, raw)
    expect(data).toEqual({ login: 'alice', id: 7, htmlUrl: 'https://github.com/alice' })
  })

  it('follows multi-segment dotted paths into nested objects', () => {
    const raw = { owner: { profile: { login: 'alice' } } }
    expect(normalize({ login: 'owner.profile.login' }, raw)).toEqual({ login: 'alice' })
  })

  it('yields undefined for a field whose path is absent from the raw response', () => {
    expect(normalize({ missing: 'not.here' }, { other: 1 })).toEqual({ missing: undefined })
  })

  it('passes the raw response through unchanged when the mapping is empty (e.g. list endpoints)', () => {
    const raw = [{ id: 1 }, { id: 2 }]
    expect(normalize({}, raw)).toBe(raw)
  })

  it('does not throw when the raw response is a primitive or null mid-path', () => {
    expect(normalize({ x: 'a.b' }, { a: 5 })).toEqual({ x: undefined })
    expect(normalize({ x: 'a.b' }, null)).toEqual({ x: undefined })
  })
})
