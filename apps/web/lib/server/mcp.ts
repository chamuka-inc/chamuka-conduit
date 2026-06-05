// The MCP method logic (SAD §MCP Server, FR-8), independent of the transport so it unit-tests
// without HTTP. tools/list projects the catalog's JSON-Schema tool definitions straight onto the
// wire. tools/call binds the OAuth-derived (tenant, end-user) auth context to exactly one
// Executor.execute call and maps the typed Result onto an MCP CallToolResult — structured content
// on success, isError on a typed failure — so a tool failure is a result, never a thrown protocol
// error (the executor already maps everything onto the closed taxonomy).

import { ExecuteRequest } from '@conduit/contracts'
import type { ActionCatalog, TenantPrincipal } from '@conduit/contracts'
import { toToolDefinitions } from '@conduit/catalog'
import type { ConduitServices } from './services'

/** The identity an MCP session acts under, derived from the validated access token. */
export interface McpAuthContext {
  readonly principal: TenantPrincipal
  readonly endUserId: string
}

interface McpToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

interface McpTextContent {
  readonly type: 'text'
  readonly text: string
}

export interface McpToolResult {
  // The index signature mirrors the MCP CallToolResult's protocol passthrough, so this is directly
  // assignable where the SDK expects a tool result without a lossy cast at the transport boundary.
  readonly [key: string]: unknown
  readonly content: McpTextContent[]
  readonly structuredContent?: Record<string, unknown>
  readonly isError?: boolean
}

/** tools/list — every catalogued action as an MCP tool (name, description, JSON-Schema input). */
export function listToolsResult(catalog: ActionCatalog): { tools: McpToolDefinition[] } {
  return {
    tools: toToolDefinitions(catalog).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }
}

/** tools/call — run one action for the bound (tenant, end-user); typed failures become isError. */
export async function callToolResult(
  services: ConduitServices,
  context: McpAuthContext,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const parsed = ExecuteRequest.safeParse({ action: name, endUserId: context.endUserId, args })
  if (!parsed.success) {
    return toolError(`validation_error: "${name}" is not a valid action invocation`)
  }
  const result = await services.executor.execute(context.principal, parsed.data)
  if (!result.ok) return toolError(`${result.error.code}: ${result.error.message}`)
  return {
    content: [{ type: 'text', text: JSON.stringify(result.value) }],
    structuredContent: result.value,
  }
}

function toolError(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
