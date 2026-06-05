import { describe, it, expect } from 'vitest'
import { ActionSpec, ToolDefinition } from '@conduit/contracts'
import {
  loadCatalog,
  toToolDefinition,
  toToolDefinitions,
  toOpenAITool,
  toAnthropicTool,
} from '../src/index'
import { validRawAction } from './fixtures'

const spec = ActionSpec.parse(validRawAction())
const catalog = loadCatalog([validRawAction()])

describe('toToolDefinition (FR-3)', () => {
  it('projects an action to a provider-agnostic tool definition', () => {
    const def = toToolDefinition(spec)
    expect(() => ToolDefinition.parse(def)).not.toThrow()
    expect(def.name).toBe(spec.name)
    expect(def.description).toBe(spec.description)
  })

  it('uses the action inputSchema verbatim as the tool parameters', () => {
    const def = toToolDefinition(spec)
    expect(def.inputSchema).toEqual(spec.inputSchema)
  })

  it('projects every action in a catalog', () => {
    expect(toToolDefinitions(catalog)).toHaveLength(1)
  })
})

describe('vendor shaping (FR-3, [R5] OpenAI / [R6] Anthropic)', () => {
  it('shapes an OpenAI function tool', () => {
    const tool = toOpenAITool(toToolDefinition(spec))
    expect(tool.type).toBe('function')
    expect(tool.function.name).toBe(spec.name)
    expect(tool.function.parameters).toEqual(spec.inputSchema)
  })

  it('shapes an Anthropic tool with input_schema', () => {
    const tool = toAnthropicTool(toToolDefinition(spec))
    expect(tool.name).toBe(spec.name)
    expect(tool.input_schema).toEqual(spec.inputSchema)
  })
})
