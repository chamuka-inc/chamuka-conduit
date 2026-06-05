import { z } from 'zod'
import { ActionName } from './ids'
import { JsonSchema } from './action'

/**
 * The provider-agnostic tool definition the Catalog emits and `GET /tools` returns (FR-3).
 * `inputSchema` is JSON Schema for function-calling. Surface-specific exporters reshape this
 * into the OpenAI `tools` / Anthropic `input_schema` formats (catalog logic, Phase 6).
 */
export const ToolDefinition = z.object({
  name: ActionName,
  description: z.string(),
  inputSchema: JsonSchema,
})
export type ToolDefinition = z.infer<typeof ToolDefinition>
