# Project: conduit

@import ./ENGINEERING_DISCIPLINE.md

## Overview

conduit is the **action/integration layer** for AI agents and applications: a declarative
tool/action catalog per app, a unified action-execution API, tool discovery with JSON
Schemas for LLM function-calling, and agent-facing surfaces (REST + an MCP server).

conduit does **not** store credentials. It depends on **credvault** — a separate Rust
service (its own repo) that stores per-end-user OAuth tokens and API keys, encrypts them at
rest, and brokers guaranteed-valid tokens. At execution time conduit asks credvault for a
valid token over credvault's HTTP API. That boundary is the only coupling between the two
systems and is pinned by contract (ADR-002, see `packages/contracts/src/credvault.ts`).

This repository is **conduit only**. credvault is an external dependency you run separately.

## Status

**conduit v1 is complete.** Modules 0–7 are implemented through the full
red→green→refactor→e2e-mock→live TDD cycle:
`@conduit/catalog`, `@conduit/store`, `@conduit/credvault-client`, `@conduit/provider-invoker`,
`@conduit/identity`, `@conduit/core` (the Executor), and `@conduit/web` (`apps/web` — the
Next.js REST Gateway at `/api/v1/*`, the MCP server at `/api/mcp` over streamable HTTP with a
full OAuth 2.1 authorization server, and a read-only operator dashboard). Every module's
live-e2e acceptance passed against a running credvault + Postgres + api.github.com.

**Next steps are post-v1** — broaden the catalog beyond GitHub (Slack needs an OAuth app
provisioned in credvault), deploy `apps/web`, and harden operability (shared
rate-limit/OAuth state, richer dashboard). See `PLAN.md` for build order and per-module
acceptance.

## Layout

```
packages/
  contracts/         # @conduit/contracts — frozen data contracts (Zod). Changes need an amendment.
  catalog/           # @conduit/catalog — action manifests + tool-schema discovery
  store/             # @conduit/store — Postgres-backed persistence (owns the `conduit` schema)
  credvault-client/  # @conduit/credvault-client — typed client for credvault's HTTP API
  provider-invoker/  # @conduit/provider-invoker — renders + executes provider HTTP requests
  identity/          # @conduit/identity — principals, tenants, API keys
  core/              # @conduit/core — the Executor over five injected ports
apps/
  web/               # @conduit/web — Next.js 16 app: REST + MCP (OAuth 2.1 AS) + dashboard
```

## Key documents

- `ENGINEERING_DISCIPLINE.md` — how engineering work is done here (imported above; loaded every session)
- `VISION.md` — north-star problem statement and definition of done
- `SPEC.md` — functional and non-functional requirements with citations
- `SAD.md` — software architecture document (30k-ft → 10k-ft → per-component zoom)
- `CONTRACTS.md` — prose documentation of the contracts package (`packages/contracts`)
- `PLAN.md` — decomposition into modules with dependency DAG and acceptance criteria
- `UX_DESIGN.md` — the four agent/operator surfaces and their mockups (`design/`)

## Working in this repo

### Branch model

`main` is the conduit trunk. Cut a `module/<name>` or `fix/<desc>` branch from `main` and
merge back into it. (Historical note: conduit was extracted from a bundled
`credvault + conduit` monorepo; this standalone repo starts fresh from that v1-complete tree. The
old `conduit/bootstrap` trunk and the bootstrap-protocol tags — `spec/*`, `sad/*`, `contracts/*`,
`plan/*`, `module/*` — lived in that prior history and are **not** present here. Where the
phase-artifact docs (`SPEC.md`/`SAD.md`/`PLAN.md`/`CONTRACTS.md`) name those tags, treat it as
historical narration.)

### Verify

```sh
pnpm install && pnpm verify   # typecheck + lint + Vitest (offline; live suites are gated off)
```

The TS *packages* use the internal-packages pattern (expose `src`; no build step). `apps/web`
is a Next.js app — its typecheck runs `next typegen && tsc` (wired into the root `typecheck`),
and `cd apps/web && pnpm build` produces the production build. `@conduit/contracts` is frozen —
changes need an amendment branch.

### Live tests

The six `test/live.test.ts` suites run against a real credvault + Postgres; they're gated so the
offline `pnpm verify` skips them and stays green. The simplest way to run them:

```sh
pnpm test:live   # = scripts/live-test.sh — supplies the env gates with local-dev defaults
```

With a sibling `../credvault` checkout whose stack is up (`docker compose up -d`), that needs no
configuration. The gate is resolved once in `@conduit/test-support` (`resolveLiveEnv()`); the three
env knobs (all overridable):

- `CONDUIT_CREDVAULT_URL` — a running credvault (default `http://localhost:8000`).
- `CONDUIT_CREDVAULT_TENANT_KEY` — the tenant key value, **or** `CONDUIT_TENANT_KEY_FILE` — a path to
  a file holding it (the script defaults this to `../credvault/secrets/tenant_key.txt`). conduit and
  credvault are now separate repos, so this is explicit — never assumed from a sibling layout in test
  code. The live GitHub connection is credvault tenant `verify-acme`, end-user `alice`.
- `CONDUIT_TEST_DATABASE_URL` — conduit Postgres (default `postgres://vault:vault@localhost:5432/vault`).
  conduit owns a dedicated `conduit` schema, isolated from credvault's `public`.

What they cover: `store`/`identity` → real Postgres; `credvault-client` → brokers a real token;
`provider-invoker` → renders + SSRF-validates + calls `api.github.com`; `core` → the full Executor
pipeline; `web` → REST `/execute` + the full MCP OAuth dance against the live container.

### Running `apps/web`

```sh
cd apps/web && pnpm dev   # Next.js, :3000
```

Env it reads: `CONDUIT_CREDVAULT_URL`, `CONDUIT_CREDVAULT_TENANT_KEY` (the credvault tenant
key), optional `CONDUIT_CREDVAULT_TENANT_REF` (default `verify-acme`), `CONDUIT_DATABASE_URL`
(Postgres; falls back to an in-memory store when unset), `CONDUIT_PUBLIC_URL` (OAuth issuer /
MCP resource origin, default `http://localhost:3000`), and `CONDUIT_OAUTH_SIGNING_SECRET`
(HS256; ephemeral per-process if unset). Provision a tenant/API key with `IdentityService.issue`
against the same store before calling the surfaces. Routes: `/api/v1/{tools,execute}`,
`/api/mcp`, `/oauth/{register,authorize,token}`, `/.well-known/oauth-*`, `/healthz`, `/readyz`,
and the dashboard at `/`.

### credvault (external dependency)

conduit needs a running credvault. Bring it up from the credvault repo (it ships a
`docker compose` stack: web :8000, worker, Postgres :5432) and point conduit at it via
`CONDUIT_CREDVAULT_URL`. conduit holds a credvault **tenant key** server-side and asks for
tokens at execution time. No backward-compat constraints — pre-release; prefer clean,
structurally-correct design.
