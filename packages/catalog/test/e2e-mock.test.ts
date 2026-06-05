import { describe, it, expect } from 'vitest'
import type { ActionCatalog } from '@conduit/contracts'
import { ExecuteRequest, ToolDefinition, conduitError } from '@conduit/contracts'
import { loadSeedCatalog, toToolDefinitions, toOpenAITool, toAnthropicTool } from '../src/index'

// E2E against mocked peers. The catalog is a leaf producer; its contract peers are its consumers
// (the Executor and the REST/MCP surfaces). Here we stand in for each consumer with a minimal
// mock that touches the catalog ONLY through the frozen ActionCatalog port + tool exporters,
// proving the seam is sufficient before the real consumers (modules 6–7) are built.

// The catalog is consumed only as the port type — consumers never see InMemoryCatalog.
const catalog: ActionCatalog = loadSeedCatalog()

describe('Executor consumer: resolve the ActionSpec for an ExecuteRequest', () => {
  // Mock of the Executor's first step (FR-4): look up the action named in the request.
  function resolveSpec(request: ExecuteRequest) {
    const spec = catalog.get(request.action)
    if (spec === undefined) {
      return conduitError('validation_error', `unknown action "${request.action}"`)
    }
    return spec
  }

  it('resolves a known action to a spec the invoker can render', () => {
    const request = ExecuteRequest.parse({
      action: 'github.create_issue',
      endUserId: 'alice',
      args: { owner: 'octo', repo: 'demo', title: 'hi' },
    })
    const resolved = resolveSpec(request)
    expect('request' in resolved && resolved.request.method).toBe('POST')
  })

  it('maps an unknown action to a validation_error (no throw across the seam)', () => {
    const request = ExecuteRequest.parse({
      action: 'github.nonexistent',
      endUserId: 'alice',
      args: {},
    })
    const resolved = resolveSpec(request)
    expect('code' in resolved && resolved.code).toBe('validation_error')
  })
})

describe('Surface consumer: build the GET /tools payload (FR-3)', () => {
  // Mock of the Gateway/MCP tools listing: the surface only needs toToolDefinitions + shapers.
  it('lists every seed action as a contract-valid tool definition', () => {
    const tools = toToolDefinitions(catalog)
    expect(tools).toHaveLength(catalog.list().length)
    for (const tool of tools) {
      expect(() => ToolDefinition.parse(tool)).not.toThrow()
    }
  })

  it('shapes the same tools for both function-calling vendors', () => {
    const tools = toToolDefinitions(catalog)
    const openai = tools.map(toOpenAITool)
    const anthropic = tools.map(toAnthropicTool)
    expect(openai.every((t) => t.type === 'function')).toBe(true)
    expect(anthropic.map((t) => t.name)).toEqual(tools.map((t) => t.name))
    // Both vendor views carry the identical JSON Schema parameters for each tool.
    openai.forEach((t, i) => expect(t.function.parameters).toEqual(anthropic[i]?.input_schema))
  })
})
