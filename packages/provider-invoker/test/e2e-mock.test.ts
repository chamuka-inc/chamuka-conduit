import { describe, it, expect } from 'vitest'
import type { ProviderInvoker, ActionSpec, AccessToken, Result } from '@conduit/contracts'
import { HttpProviderInvoker, renderRequest } from '../src/index'
import { spec, token, stubFetch } from './fixtures'
import type { CapturedRequest } from './fixtures'

// E2E against a mocked peer. The provider-invoker is a leaf producer; its contract consumer is the
// Executor (module 6), which renders a request from an ActionSpec + args and then invokes the
// provider with a resolved token. Here a minimal FakeExecutor touches the invoker ONLY through the
// frozen ProviderInvoker port (renderRequest is the module's pure render util the Executor reuses),
// with the provider stood in by a stubbed FetchLike — proving the seam before the real Executor.

// The consumer sees the port type, never the concrete HttpProviderInvoker — which also proves
// HttpProviderInvoker conforms to the frozen port.
function invokerReturning(status: number, body: unknown): {
  invoker: ProviderInvoker
  calls: CapturedRequest[]
} {
  const stub = stubFetch(status, body)
  return { invoker: new HttpProviderInvoker({ fetch: stub.fetch }), calls: stub.calls }
}

// Mock of the Executor's render+invoke step: render the spec, then either invoke the provider with
// the token or surface the render failure without opening any socket.
class FakeExecutor {
  constructor(private readonly invoker: ProviderInvoker) {}

  async run(
    actionSpec: ActionSpec,
    args: Record<string, unknown>,
    accessToken: AccessToken,
  ): Promise<Result<unknown>> {
    const rendered = renderRequest(actionSpec, args)
    if (!rendered.ok) return rendered
    return this.invoker.call(actionSpec, rendered.value, accessToken)
  }
}

describe('Executor consumer: render + invoke through the ProviderInvoker port', () => {
  it('renders the spec and invokes the provider with the token, returning raw JSON', async () => {
    const { invoker, calls } = invokerReturning(200, { login: 'alice', id: 7 })
    const executor = new FakeExecutor(invoker)
    const result = await executor.run(spec(), {}, token())

    expect(result).toEqual({ ok: true, value: { login: 'alice', id: 7 } })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.github.com/user')
    expect(calls[0]?.headers.authorization).toBe('Bearer gho_live_token')
  })

  it('fails closed (validation_error) and opens no socket when the rendered host is not allowlisted', async () => {
    const { invoker, calls } = invokerReturning(200, {})
    const executor = new FakeExecutor(invoker)
    const evil = spec({
      providerHosts: ['api.github.com'],
      request: { method: 'GET', urlTemplate: 'https://169.254.169.254/latest/meta-data/' },
    })
    const result = await executor.run(evil, {}, token())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
    expect(calls).toHaveLength(0)
  })

  it('surfaces a render failure (missing arg) without invoking the provider', async () => {
    const { invoker, calls } = invokerReturning(200, {})
    const executor = new FakeExecutor(invoker)
    const needsArgs = spec({
      request: { method: 'GET', urlTemplate: 'https://api.github.com/repos/{owner}/{repo}' },
    })
    const result = await executor.run(needsArgs, { owner: 'octo' }, token())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('validation_error')
    expect(calls).toHaveLength(0)
  })
})
