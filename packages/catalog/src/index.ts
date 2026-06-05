// @conduit/catalog — loads and validates the declarative action catalog (FR-1) and projects it
// to the function-calling tool surface (FR-3). Produces the ActionCatalog port impl the Executor
// and surfaces consume. Depends only on the frozen @conduit/contracts.

export { loadCatalog } from './load'
export type { LoadOptions } from './load'
export { loadSeedCatalog } from './seed'
export { InMemoryCatalog } from './catalog'
export { CatalogError } from './errors'
export {
  toToolDefinition,
  toToolDefinitions,
  toOpenAITool,
  toAnthropicTool,
} from './tools'
export type { OpenAITool, AnthropicTool } from './tools'
