import { describe, it, expect } from 'vitest'
import { ArgsValidator } from '../src/index'
import { spec } from './fixtures'

// ArgsValidator enforces FR-4b: an action's input arguments are validated against its declared
// inputSchema (JSON Schema, draft 2020-12) before any token is resolved or socket opened. A
// failure is the closed-taxonomy `validation_error`, never a thrown exception.

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

describe('ArgsValidator', () => {
  it('accepts arguments that satisfy the input schema', () => {
    const result = new ArgsValidator().validate(createIssue(), {
      owner: 'octo',
      repo: 'hello',
      title: 'Bug',
    })
    expect(result.ok).toBe(true)
  })

  it('accepts an empty object for an action that declares no properties', () => {
    expect(new ArgsValidator().validate(spec(), {}).ok).toBe(true)
  })

  it('rejects a missing required property as validation_error', () => {
    const result = new ArgsValidator().validate(createIssue(), { owner: 'octo', repo: 'hello' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
  })

  it('rejects an undeclared property (additionalProperties: false) as validation_error', () => {
    const result = new ArgsValidator().validate(spec(), { surprise: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
  })

  it('rejects a property of the wrong type and reports the offending paths in details', () => {
    const result = new ArgsValidator().validate(createIssue(), {
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
