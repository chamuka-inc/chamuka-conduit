# Chamuka Conduit

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Declarative action layer for AI agents over REST and MCP.

**conduit** is the action/integration layer for AI agents and applications. It turns
third-party SaaS APIs into callable, schema-typed actions — discoverable as LLM
function-calling tools and over an MCP server, and executable through a single unified API.

A new integration is a set of **declarative manifests**, not a code change: each action
declares its endpoint, input schema (JSON Schema), auth method, and output contract, and a
generic engine validates, resolves credentials, renders the request, executes it, and
normalizes the response.

conduit deliberately does **not** store credentials. It delegates token storage, refresh,
and rotation to [**credvault**](https://github.com/chamuka-inc/chamuka-credvault), a separate
credential-vault service — and asks it for a guaranteed-valid token at execution time. That
HTTP boundary is the only coupling between the two and is pinned by contract.

## Architecture

A four-layer action plane sitting between agents and provider APIs:

- **Tool surface** — REST API (`/api/v1/*`) and an MCP server (`/api/mcp`, streamable HTTP)
  with a full OAuth 2.1 authorization server.
- **Invocation engine** (`@conduit/core`) — the Executor: identity resolution → credential
  fetch (via credvault) → request rendering → execution → response normalization.
- **Catalog** (`@conduit/catalog`) — action manifests and tool-schema discovery.
- **Identity** (`@conduit/identity`) — principals, tenants, API keys; maps principals to
  credvault credentials.

```
packages/
  contracts/         frozen data contracts (Zod)
  catalog/           action manifests + tool-schema discovery
  store/             Postgres-backed persistence (owns the `conduit` schema)
  credvault-client/  typed client for credvault's HTTP API
  provider-invoker/  renders + executes provider HTTP requests
  identity/          principals, tenants, API keys
  core/              the Executor over five injected ports
apps/
  web/               Next.js 16 app — REST + MCP (OAuth 2.1 AS) + operator dashboard
```

## Status

**v1 complete** — all modules implemented and live-verified against a running credvault +
Postgres + the GitHub API. Next steps are post-v1: broaden the catalog beyond GitHub, deploy
`apps/web`, and harden operability. See [`PLAN.md`](PLAN.md).

## Development

Requires Node ≥ 20 and pnpm. A running [credvault](https://github.com/chamuka-inc/chamuka-credvault)
is needed for the live test suites and to actually execute actions.

```sh
pnpm install
pnpm verify          # typecheck + lint + Vitest (offline; live suites are gated off)

cd apps/web
cp .env.example .env.local   # then fill in CONDUIT_CREDVAULT_TENANT_KEY
pnpm dev                     # Next.js dev server on :3000
```

### Live tests

The `*/test/live.test.ts` suites exercise the real flow against a running credvault + Postgres, and
are gated so `pnpm verify` stays offline. With a sibling `../credvault` checkout whose stack is up
(`docker compose up -d`):

```sh
pnpm test:live       # runs the full suite incl. live, auto-discovering credvault's tenant key
```

The gate resolves three env vars (`CONDUIT_CREDVAULT_URL`, `CONDUIT_TEST_DATABASE_URL`, and either
`CONDUIT_CREDVAULT_TENANT_KEY` or `CONDUIT_TENANT_KEY_FILE`), all overridable — see
[`CLAUDE.md`](CLAUDE.md) and `scripts/live-test.sh`.

## Documentation

| Doc | What it covers |
|---|---|
| [`VISION.md`](VISION.md) | North-star problem statement and definition of done |
| [`SPEC.md`](SPEC.md) | Functional and non-functional requirements |
| [`SAD.md`](SAD.md) | Software architecture (system → component zoom) |
| [`CONTRACTS.md`](CONTRACTS.md) | The frozen `@conduit/contracts` package |
| [`PLAN.md`](PLAN.md) | Module decomposition, dependency DAG, acceptance criteria |
| [`UX_DESIGN.md`](UX_DESIGN.md) | The four agent/operator surfaces (mockups in `design/`) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Report vulnerabilities to [security@chamuka.ai](mailto:security@chamuka.ai). See [SECURITY.md](SECURITY.md).

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

---

Part of [Chamuka Labs](https://chamuka.ai), an applied AI lab.
