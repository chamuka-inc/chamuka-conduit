import type { ActionCatalog, ActionSpec, JsonSchema, ToolDefinition } from '@conduit/contracts'

/** Project an action to the provider-agnostic {@link ToolDefinition} surface (FR-3). */
export function toToolDefinition(spec: ActionSpec): ToolDefinition {
  return { name: spec.name, description: spec.description, inputSchema: spec.inputSchema }
}

/** Project every action a catalog holds to its tool definition (FR-3). */
export function toToolDefinitions(catalog: ActionCatalog): ToolDefinition[] {
  return catalog.list().map(toToolDefinition)
}

/** OpenAI function-calling tool shape [R5]. */
export interface OpenAITool {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: JsonSchema
  }
}

export function toOpenAITool(def: ToolDefinition): OpenAITool {
  return {
    type: 'function',
    function: { name: def.name, description: def.description, parameters: def.inputSchema },
  }
}

/** Anthropic tool-use shape [R6]; `input_schema` is snake_case per the vendor contract. */
export interface AnthropicTool {
  readonly name: string
  readonly description: string
  readonly input_schema: JsonSchema
}

export function toAnthropicTool(def: ToolDefinition): AnthropicTool {
  return { name: def.name, description: def.description, input_schema: def.inputSchema }
}
