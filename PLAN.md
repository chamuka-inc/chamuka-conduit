# Implementation Plan

> Decomposition of conduit v1 into TypeScript modules (pnpm workspace packages + one Next.js
> app). Each module depends only on the frozen `@conduit/contracts` and on lower modules through
> their published contracts. This is what makes "one module at a time, protected by contracts"
> work.

## Prerequisites

- [x] `contracts/v0.1.0-frozen` tag exists
- [x] `SPEC.md` (`spec/v0.1.0`), `SAD.md` (`sad/v0.1.1`), `CONTRACTS.md` committed
- [x] Final confidence gate (below) is "high"

### Scheduled contract amendment (first action of Phase 6)

Decomposition surfaced one missing seam: the **Executor must resolve an `ActionSpec` by name**,
but no `ActionCatalog` port was frozen. Per the freeze discipline this is **not** a casual edit —
it is a `contracts/amendment-catalog-port` branch adding:

```ts
export interface ActionCatalog {
  get(name: ActionName): ActionSpec | undefined
  list(): readonly ActionSpec[]
}
```

…bumping the contracts package to **0.2.0** and re-tagging `contracts/v0.2.0-frozen`. It is the
prerequisite for module 6 (`core`) and is listed as module 0 below.

## Dependency DAG

```
                    @conduit/contracts  (frozen)
                              │
        ┌──────────┬──────────┼───────────┬──────────────┐
        │          │          │           │              │
     catalog     store   credvault-   provider-        (ports
        │          │       client      invoker      consumed by core)
        │          │          │           │
        │      identity       │           │
        │          │          │           │
        └────┬─────┴────┬─────┴─────┬─────┘
             │          │           │
             ▼          ▼           ▼
                      core  (Executor; impls injected via ports)
                              │
                              ▼
                         apps/web   (REST + MCP + dashboard; wires all impls)
```

**Acyclic** ✓. `core` depends at compile time only on `contracts` (+ the `ActionCatalog` port)
and `catalog`; the resolver/invoker/store implementations reach it through injected ports, so the
concrete modules are leaves the app wires together — no cycle is expressible.

## Implementation order

### 0. `contracts` amendment — `ActionCatalog` port
- **Depends on:** frozen `contracts/v0.1.0-frozen`
- **Change:** add the `ActionCatalog` port (above); bump to `0.2.0`; re-tag `contracts/v0.2.0-frozen`.
- **Acceptance:** package typechecks + existing tests stay green; a new test asserts the port shape.
- **Complexity:** S · **Risks:** none (additive, pre-implementation).

### 1. `@conduit/catalog`
- **Depends on:** `contracts`
- **Consumes:** `ActionSpec`, `JsonSchema`, `ToolDefinition`, `ActionName`
- **Produces:** `ActionCatalog` impl (load/validate seed + runtime override), `ToolDefinition`
  exports (+ OpenAI/Anthropic shaping), the seed catalog JSON (`github.get_authenticated_user`,
  `github.create_issue`, `github.list_repositories`).
- **Acceptance (live e2e):** loading the real seed catalog, `get('github.create_issue')` returns a
  valid `ActionSpec`; `list()`→tool defs whose `inputSchema` is valid JSON Schema; a malformed
  action is rejected at load (fail-fast, FR-1).
- **Complexity:** M · **Risks:** the templating/normalization data shape is the novel surface
  (kept to single-call actions in v1).

### 2. `@conduit/store`
- **Depends on:** `contracts` (+ `kysely`, `pg`)
- **Consumes:** `AuditEntry`, `ExecuteResult`, `TenantId`, `IdempotencyKey`
- **Produces:** `AuditSink`, `IdempotencyStore`, `TenantStore` impls + migrations.
- **Acceptance (live e2e against real Postgres):** idempotency `put`/`get` round-trips and the
  unique `(tenant,key)` constraint enforces exactly-once (NFR-DUR-2); audit append persists
  (NFR-DUR-1); tenant insert + `api_key_hash` lookup.
- **Complexity:** M · **Risks:** migration/runtime parity (mitigated by testing against real PG,
  as credvault does).

### 3. `@conduit/credvault-client`
- **Depends on:** `contracts`
- **Consumes:** `CredvaultCredential`, `TenantPrincipal`; **Produces:** `TokenResolver` impl.
- **Acceptance (live e2e against the running credvault):** resolve a token for a connected
  end-user (`alice`/`github`) → `AccessToken`; a 404 → `not_connected` `ConduitError` (FR-6).
- **Complexity:** S · **Risks:** credvault API drift — pinned by `CredvaultCredential` + this e2e.

### 4. `@conduit/provider-invoker`
- **Depends on:** `contracts`
- **Consumes:** `ActionSpec`, `RenderedRequest`, `AccessToken`; **Produces:** `ProviderInvoker`
  impl (render + SSRF validation + timed HTTP).
- **Acceptance (live e2e):** with a real token, `github.get_authenticated_user` calls
  `api.github.com` and returns raw user JSON; a spec rendering to an internal/non-allowlisted host
  fails closed (FR-11).
- **Complexity:** M · **Risks:** SSRF correctness — port credvault's `validate_endpoint`/
  `is_global_ip` logic and test the same vectors.

### 5. `@conduit/identity`
- **Depends on:** `contracts`, `store`
- **Consumes:** `TenantPrincipal`, `TenantId`; **Produces:** API-key issue/verify, principal
  resolution.
- **Acceptance (live e2e):** issue a conduit API key for a project mapped to a credvault tenant;
  verify resolves the `TenantPrincipal`; unknown key → null (NFR-SEC-1).
- **Complexity:** S · **Risks:** none notable (mirrors credvault's tenant/api-key hashing).

### 6. `@conduit/core` (the Executor)
- **Depends on:** `contracts` (+ `ActionCatalog` port), `catalog`
- **Consumes (injected ports):** `TokenResolver`, `ProviderInvoker`, `AuditSink`,
  `IdempotencyStore`, `ActionCatalog`; **Produces:** `Executor.execute(ExecuteRequest) →
  ExecuteResult | ConduitError`, plus pure render/normalize utilities.
- **Acceptance:**
  - *e2e-mock:* with mocked ports, a valid request yields `ExecuteResult`; every error path is
    covered — bad args→`validation_error`, resolver miss→`not_connected`, repeated idempotency
    key replays without re-invoking the invoker, provider 5xx→`provider_error`, timeout→
    `upstream_timeout` (FR-4, FR-5, FR-7).
  - *live:* wired to the real credvault-client + provider-invoker + store + catalog,
    `github.get_authenticated_user` for `alice` returns a normalized `{data,raw}`.
- **Complexity:** L (the heart) · **Risks:** render/normalize edge cases — bounded by single-call
  v1 actions; covered by unit tests on the pure utilities.

### 7. `apps/web` (Next.js — Gateway + MCP + dashboard)
- **Depends on:** `contracts`, `core`, `catalog`, `identity`, `credvault-client`,
  `provider-invoker`, `store`
- **Produces:** REST route handlers (`/api/v1/tools`, `/api/v1/execute`, `/healthz`, `/readyz`),
  the MCP route handler (`/api/mcp`, Streamable HTTP), and an operator dashboard.
- **Acceptance (live e2e, end-to-end against running credvault + Postgres):**
  - *REST:* `GET /tools` returns tool defs; `POST /execute {github.get_authenticated_user, alice}`
    returns the normalized profile; bad input → 400, no connection → 409 (FR-3, FR-4, FR-5).
  - *MCP:* an MCP client `initialize`s, `tools/list` shows the actions, `tools/call` executes one
    and returns the result (FR-8).
- **Complexity:** L · **Risks:** MCP Streamable-HTTP adapter library must be pinned to a current
  version + verified against the live MCP spec revision (SAD residual risk).

---

## Per-module TDD cycle (applies to every entry above)

For each module, in order: branch `module/<name>` from `main` →
**red** (`module/<name>/red`) → **green** (`/green`) → **refactor** (`/refactored`) →
**e2e-mock** (`/e2e-mock`) → **live** (`/live-verified`) → merge to `main` (`/done`).
Commit trailers carry `Module:`, `Contract:`, `Phase:`. See `ENGINEERING_DISCIPLINE.md`.

## Status snapshot

> Maintained by git, not by hand:
>
> ```sh
> git tag --list 'module/*'
> ```

---

## Delivery status & post-v1 gaps

**conduit v1 is delivered.** Module 0 (the `ActionCatalog` amendment) and modules 1–7 are merged to
trunk (`conduit/bootstrap`) and tagged `module/<name>/done`, each through the full
red→green→refactor→e2e-mock→live cycle. The pre-implementation residual risks above are resolved:
the `ActionCatalog` amendment shipped (`contracts/v0.2.0-frozen`), and the MCP Streamable-HTTP adapter
is pinned (`mcp-handler@1.1.0` + `@modelcontextprotocol/sdk@1.26.0`) and verified against MCP auth
spec rev `2025-06-18`.

The following gaps were surfaced during implementation / live exercise and are **deferred to post-v1**
(none blocked v1 acceptance; listed highest-leverage first):

- **Rate limiting is not implemented (FR / SAD Gateway).** The SAD Gateway lists rate-limiting (→ `429`
  `rate_limited`); v1 ships no limiter and no `429` path on `/api/v1/*`. The error code exists in the
  taxonomy but is never produced by the surface. Needs a limiter + a shared/durable counter store
  (the "per-instance vs shared rate-limit store" the gate flagged). **Severity: medium** (abuse/cost).
- **OAuth 2.1 AS state is in-memory and per-instance.** `apps/web/lib/server/oauth/store.ts` holds
  registered DCR clients and authorization codes in process memory, and the access-token signing
  secret falls back to an ephemeral per-process key unless `CONDUIT_OAUTH_SIGNING_SECRET` is set.
  Fine for single-instance v1; before any multi-instance/serverless deploy these need durable, shared
  backing (DB/redis) and a persistent signing secret (or rotation), or tokens/codes break across
  instances and restarts. **Severity: high for multi-instance deploy.**
- **MCP discovery was only validated end-to-end after v1.** The e2e-mock/live suites minted access
  tokens directly and skipped the OAuth *discovery* hop, which hid a real defect: the 401
  `WWW-Authenticate` advertised the protected-resource metadata at a path that 404'd. Fixed
  (`fix/mcp-oauth-discovery`: canonical OAuth resource = origin) with a regression assertion. Gap
  remaining: there is no automated **full-MCP-client** test (discover → DCR → PKCE authorize → token →
  `initialize`/`tools/list`/`tools/call`); add one using `@modelcontextprotocol/sdk`'s `Client` so the
  discovery chain can't silently regress. **Severity: medium.**
- **`slack.post_message` (additive breadth).** Still GitHub-only. The pipeline supports it as a
  single-call action; needs a Slack OAuth app + scopes provisioned in credvault, a connection for the
  end-user, and the action added to the seed catalog. No new modules. **Severity: low** (breadth).
- **Operator dashboard is minimal.** Read-only catalog + recent audit (with client `router.refresh()`
  auto-refresh, `fix/dashboard-auto-refresh`). No tenant management, filtering, pagination, or
  connection status. The richer view (and, if it grows, a `GET /api/v1/audit` endpoint + TanStack
  Query) is deferred. **Severity: low.**
- **Not yet deployed.** `apps/web` runs locally (`pnpm dev`/`build`); no Vercel/self-host deploy,
  health-gated rollout, or production env wiring. **Severity: n/a until deploy is wanted.**

The most plan-aligned next feature is the **Slack provider** (the named additive-breadth item); the
most production-aligned work is **rate limiting + durable OAuth/rate-limit state** ahead of a deploy.

---

## Final confidence gate

Confidence in delivering conduit v1 end-to-end given Phases 0–5:

```
Confidence: high
Residual risks:
  - The ActionCatalog port amendment (module 0) re-touches the frozen contracts; it is additive
    and pre-implementation, so low-risk, but it means contracts/v0.1.0-frozen is superseded by
    v0.2.0 before any module ships.
  - slack.post_message needs a Slack OAuth app + scopes provisioned in credvault; the entire
    pipeline (catalog → core → web, REST + MCP) is fully verifiable on GitHub alone first, so
    Slack is additive breadth, not a blocker.
  - The MCP Streamable-HTTP adapter for Next.js route handlers must be pinned at module 7 and
    checked against the current MCP spec revision.
Known gaps:
  - None blocking. Rate-limit store (per-instance vs shared) and dashboard scope are operability
    details deferred into module 7, not boundary questions.
```

High: the DAG is acyclic, every module's acceptance is a live e2e against its contract boundary,
and the one discovered seam gap has a scheduled amendment rather than an ad-hoc edit. Proceed to
commit `docs: implementation plan` and tag `plan/v0.1.0`. Phase 6 may begin.
