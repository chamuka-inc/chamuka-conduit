import { describe, it, expect } from 'vitest'
import { callToolResult, listToolsResult } from '../lib/server/mcp'
import { buildServices, notConnected } from './helpers'

// The MCP method logic (SAD §MCP Server, FR-8), extracted from the transport so it unit-tests
// without HTTP: tools/list projects the catalog; tools/call binds the OAuth-derived (tenant,
// end-user) auth context to one Executor call and maps the typed Result onto an MCP CallToolResult
// (structured content on success, isError on a typed failure — never a thrown protocol error).

describe('MCP tools/list', () => {
  it('projects the catalog actions to MCP tool definitions (FR-8)', async () => {
    const { services } = await buildServices()
    const result = listToolsResult(services.catalog)
    const names = result.tools.map((t) => t.name)
    expect(names).toContain('github.get_authenticated_user')
    const tool = result.tools.find((t) => t.name === 'github.get_authenticated_user')
    expect(tool?.inputSchema).toBeTypeOf('object')
  })
})

describe('MCP tools/call', () => {
  it('executes the action for the bound tenant + end-user and returns structured content', async () => {
    const { services, principal } = await buildServices()
    const result = await callToolResult(
      services,
      { principal, endUserId: 'alice' },
      'github.get_authenticated_user',
      {},
    )
    expect(result.isError).toBeFalsy()
    const structured = result.structuredContent as { data: { login: string } }
    expect(structured.data.login).toBe('alice')
  })

  it('maps a typed executor error to an MCP tool error (isError), not a thrown protocol error', async () => {
    const { services, principal } = await buildServices({ token: notConnected() })
    const result = await callToolResult(
      services,
      { principal, endUserId: 'alice' },
      'github.get_authenticated_user',
      {},
    )
    expect(result.isError).toBe(true)
    const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ')
    expect(text).toContain('not_connected')
  })

  it('maps schema-invalid args to an MCP tool error', async () => {
    const { services, principal } = await buildServices()
    const result = await callToolResult(
      services,
      { principal, endUserId: 'alice' },
      'github.get_authenticated_user',
      { surprise: 1 },
    )
    expect(result.isError).toBe(true)
  })

  it('maps an unknown tool name to an MCP tool error', async () => {
    const { services, principal } = await buildServices()
    const result = await callToolResult(
      services,
      { principal, endUserId: 'alice' },
      'github.does_not_exist',
      {},
    )
    expect(result.isError).toBe(true)
  })
})
