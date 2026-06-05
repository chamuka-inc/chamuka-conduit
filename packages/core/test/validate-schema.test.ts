import { describe, it, expect } from 'vitest'
import { SchemaValidator } from '../src/index'
import { spec } from './fixtures'

// SchemaValidator enforces FR-4a and FR-4e (FD-3): an action's input arguments are validated against
// its inputSchema before any token is resolved or socket opened (a failure is the caller-blaming
// `validation_error`), and the normalized output is validated against its outputSchema before the
// {data,raw} envelope is returned (a failure is conduit's own broken contract, so `internal`).
// Neither path throws.

const createIssue = () =>
  spec({
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['owner', 'repo', 'title'],
      additionalProperties: false,
    },
  })

describe('SchemaValidator.validateInput (FR-4a)', () => {
  it('accepts arguments that satisfy the input schema', () => {
    const result = new SchemaValidator().validateInput(createIssue(), {
      owner: 'octo',
      repo: 'hello',
      title: 'Bug',
    })
    expect(result.ok).toBe(true)
  })

  it('accepts an empty object for an action that declares no properties', () => {
    expect(new SchemaValidator().validateInput(spec(), {}).ok).toBe(true)
  })

  it('rejects a missing required property as validation_error', () => {
    const result = new SchemaValidator().validateInput(createIssue(), { owner: 'octo', repo: 'hello' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
  })

  it('rejects an undeclared property (additionalProperties: false) as validation_error', () => {
    const result = new SchemaValidator().validateInput(spec(), { surprise: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
  })

  it('rejects a property of the wrong type and reports the offending paths in details', () => {
    const result = new SchemaValidator().validateInput(createIssue(), {
      owner: 'octo',
      repo: 'hello',
      title: 123,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error')
      expect(result.error.details).toBeDefined()
    }
  })
})

describe('SchemaValidator.validateOutput (FR-4e / FD-3)', () => {
  const userSpec = () =>
    spec({
      outputSchema: {
        type: 'object',
        properties: {
          login: { type: 'string' },
          id: { type: 'integer' },
          htmlUrl: { type: 'string' },
        },
        required: ['login', 'id'],
      },
    })

  it('accepts normalized data that satisfies the output schema', () => {
    const result = new SchemaValidator().validateOutput(userSpec(), {
      login: 'alice',
      id: 7,
      htmlUrl: 'https://github.com/alice',
    })
    expect(result.ok).toBe(true)
  })

  it('rejects data that violates the output schema as internal — never the caller-blaming code', () => {
    // `id` is a string, not the declared integer: conduit's own output contract is broken.
    const result = new SchemaValidator().validateOutput(userSpec(), { login: 'alice', id: 'seven' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('internal')
      expect(result.error.details).toBeDefined()
    }
  })

  it('rejects data missing a required output field as internal', () => {
    const result = new SchemaValidator().validateOutput(userSpec(), { login: 'alice' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('internal')
  })
})
