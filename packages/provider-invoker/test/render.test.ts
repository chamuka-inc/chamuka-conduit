import { describe, it, expect } from 'vitest'
import { renderRequest } from '../src/index'
import { spec } from './fixtures'

// renderRequest is the pure step that turns an ActionSpec template + validated args into a
// RenderedRequest (FR-4c). String leaves may carry `{arg}` placeholders resolved from the args.
// It does no I/O and never injects the token (that is the invoker's job, at call time).

describe('renderRequest', () => {
  it('renders a no-placeholder spec verbatim', () => {
    const r = renderRequest(spec(), {})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({
        method: 'GET',
        url: 'https://api.github.com/user',
        headers: { accept: 'application/vnd.github+json' },
        body: undefined,
      })
    }
  })

  it('substitutes path placeholders and percent-encodes them', () => {
    const s = spec({
      request: {
        method: 'GET',
        urlTemplate: 'https://api.github.com/repos/{owner}/{repo}/issues',
      },
    })
    const r = renderRequest(s, { owner: 'octo cat', repo: 'hello/world' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.url).toBe('https://api.github.com/repos/octo%20cat/hello%2Fworld/issues')
    }
  })

  it('appends substituted query parameters', () => {
    const s = spec({
      request: {
        method: 'GET',
        urlTemplate: 'https://api.github.com/search/issues',
        query: { q: '{term}', per_page: '{count}' },
      },
    })
    const r = renderRequest(s, { term: 'is:open label:bug', count: 30 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const url = new URL(r.value.url)
      expect(url.searchParams.get('q')).toBe('is:open label:bug')
      expect(url.searchParams.get('per_page')).toBe('30')
    }
  })

  it('substitutes placeholders in header values and string body leaves', () => {
    const s = spec({
      request: {
        method: 'POST',
        urlTemplate: 'https://api.github.com/repos/{owner}/{repo}/issues',
        headers: { 'x-trace': 'req-{owner}' },
        body: { title: '{title}', labels: ['{label}'], draft: true },
      },
    })
    const r = renderRequest(s, { owner: 'octo', repo: 'hello', title: 'Bug', label: 'p1' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.method).toBe('POST')
      expect(r.value.headers).toEqual({ 'x-trace': 'req-octo' })
      expect(r.value.body).toEqual({ title: 'Bug', labels: ['p1'], draft: true })
    }
  })

  it('fails closed with validation_error when a referenced placeholder has no arg', () => {
    const s = spec({
      request: { method: 'GET', urlTemplate: 'https://api.github.com/repos/{owner}/{repo}' },
    })
    const r = renderRequest(s, { owner: 'octo' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('validation_error')
  })

  it('fails closed when substitution yields a malformed URL', () => {
    const s = spec({ request: { method: 'GET', urlTemplate: '{base}/user' } })
    const r = renderRequest(s, { base: 'not a url' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('validation_error')
  })
})
