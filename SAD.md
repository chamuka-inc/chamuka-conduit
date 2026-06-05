# Software Architecture Document

> Scope: conduit v1 core slice (`SPEC.md`, `spec/v0.1.0`). Top-down: 30k → 10k →
> per-component. credvault is a fixed upstream dependency, consumed over its HTTP API.

## 30,000-ft view

### Context

```
        ┌────────────────────────────────────────────────────────────────┐
        │                          conduit                               │
 agent  │   ┌───────────┐                                                │
 / LLM ─┼──►│ REST API  │──┐                                             │
 app    │   └───────────┘  │      ┌──────────┐   token    ┌────────────┐│
        │   ┌───────────┐  ├────► │ Executor │───request─►│ credvault  ││──► (token)
 MCP    ─┼──►│ MCP server│──┘      └────┬─────┘            │  (Rust)    ││
 client │   └───────────┘              │ provider call    └────────────┘│
        │                              ▼                                 │
        │                       ┌─────────────┐        ┌──────────────┐ │
        │                       │  Postgres   │        │  provider    │ │──► GitHub / Slack
        │                       │ (audit,     │        │  HTTP egress │ │     APIs
        │                       │  idemp.,    │        └──────────────┘ │
        │                       │  tenants)   │                         │
        │                       └─────────────┘                         │
        └────────────────────────────────────────────────────────────────┘
```

**External actors:** (1) the *caller* — an agent/LLM app hitting REST or MCP; (2)
*credvault* — the credential broker conduit depends on; (3) *providers* — GitHub, Slack
(the apps actions target); (4) the *operator* — who deploys and configures conduit.

### Trust boundaries

- **Internet → surfaces.** Callers are untrusted. Authenticated at the edge: REST by a
  conduit API key (bearer); MCP by the MCP authorization framework (OAuth 2.1). The tenant
  is derived server-side from the credential — never read from the request (NFR-SEC-1).
- **conduit → credvault.** Trusted internal hop. conduit holds one credvault *tenant key per
  project* (FD-1), delivered as a mounted secret (`*_FILE`). This is the only place a
  credvault credential exists in conduit.
- **conduit → providers.** Egress with the end-user's token (fetched per request from
  credvault). The SSRF boundary (FR-11): only the action's declared provider host, https,
  non-internal — validated before any socket opens.
- **conduit → Postgres.** Internal datastore for conduit-owned state (tenants, API-key
  hashes, audit, idempotency). **No provider tokens are persisted here** — credvault owns those.

### Out-of-band concerns

- **Topology:** stateless surfaces + core scale horizontally by replica count (NFR-PERF-2),
  fronted by a load balancer. Postgres is the single stateful dependency conduit owns.
  credvault + its Postgres are deployed separately (already containerized).
- **State at rest:** conduit's Postgres holds tenants, API-key *hashes*, audit records, and
  idempotency entries. credvault's Postgres (separate) holds the encrypted provider tokens.
- **Packaging:** a single Next.js app (`apps/conduit`) hosts both surfaces (REST + MCP route
  handlers) and the operator dashboard; deploy to Vercel or self-host (`next start` /
  `output: 'standalone'`). A `migrate` one-shot applies schema migrations, mirroring credvault.
  Framework-agnostic logic lives in `packages/{contracts,catalog,core,store}` (pnpm workspace).

## 10,000-ft view

### Components

Two thin **surfaces** translate external protocols into calls on one shared **application
core**; the core owns all logic.

- **Gateway (REST):** terminates HTTP, authenticates the caller → tenant, rate-limits,
  validates the request envelope, calls the core. Owns no business logic.
- **MCP Server:** speaks MCP (Streamable HTTP primary, stdio for dev); maps `tools/list`→
  discovery and `tools/call`→execute; binds end-user identity per authenticated session.
- **Catalog:** loads and validates the declarative action definitions; answers "what actions
  exist" and emits tool definitions (JSON Schema, OpenAI/Anthropic shapes). Read-only at runtime.
- **Executor:** the orchestration core — validate args → resolve token → render request →
  invoke provider → normalize → typed result/error. The only component that sequences a
  full execution.
- **Credvault Client:** typed client for credvault's HTTP API; resolves a valid token for
  `(tenant, end_user_id, provider)`. Holds the per-project credvault tenant key.
- **Provider Invoker:** SSRF-safe outbound HTTP — renders the request template, validates the
  target, executes with a timeout, returns the raw response.
- **Identity & Tenancy:** conduit API keys (hashed) → tenant; tenant → credvault tenant key.
  The authority for "who is this caller".
- **Execution Records:** Postgres-backed audit log (FR-10) and idempotency store (FR-7).

- **`@conduit/contracts` (package, not a runtime component):** the Zod-sourced schemas,
  shared types, and error taxonomy every component above imports. The freeze target.

### Interaction diagram — `execute`

```
caller ─► Gateway                      (authn → tenant; rate-limit; envelope validate)
            │
            ▼
         Executor.execute(tenant, end_user_id, action, args, idem_key?)
            │ 1. Idempotency: if idem_key seen for tenant → return stored result
            │ 2. Catalog.get(action) → spec; validate args vs input_schema  (FR-1, FR-4a)
            │ 3. CredvaultClient.token(tenant, end_user_id, provider)        (FR-6)
            │       └─ 404 → not_connected (STOP, no provider call)
            │ 4. ProviderInvoker.call(spec.request, args, token)             (FR-4c/d, FR-11)
            │ 5. normalize(response, spec.normalize) → {data, raw}           (FR-4e, FD-3)
            │ 6. ExecutionRecords.audit(...) ; persist idem result          (FR-10, FR-7)
            ▼
         typed result  ──►  Gateway  ──►  caller     (or typed error at any step, FR-5)
```

### Boundary rationale

- **Surfaces are adapters, core is logic.** REST and MCP differ only in transport and
  framing; putting any execution logic in a surface would duplicate it. Both call the same
  `Executor` (ADR-001).
- **Catalog ≠ Executor.** The catalog is pure, read-only data + schema export; the executor
  is stateful orchestration with I/O. Separating them keeps the catalog trivially testable and
  lets tool-discovery run without touching the execution path.
- **Credvault Client is its own component.** It is the single seam to the upstream contract;
  isolating it means the rest of conduit is testable against a mock and the live-e2e boundary
  is one file (ADR-002).
- **Provider Invoker is its own component.** Egress + SSRF defense + timeouts are a security
  boundary; concentrating them prevents an action author from accidentally bypassing the check.
- **Identity & Execution Records are separate from the Executor** because they are persistence
  concerns with their own failure/consistency semantics, not orchestration.

## Per-component zoom

### Gateway (REST)

**Responsibility.** Terminate HTTP for the REST surface and turn an authenticated request into
exactly one core call, returning the core's typed result/error as HTTP.

**Internal structure.** Next.js App Router route handlers (`app/api/v1/tools/route.ts`,
`app/api/v1/execute/route.ts`, `app/healthz`, `app/readyz`); auth helper (bearer → tenant via
Identity); rate-limit helper; envelope validation (Zod); a typed error → HTTP-status mapper
(FR-5). Handlers call `@conduit/core`; they hold no business logic.

**State.** None (stateless). Rate-limit counters are per-instance/in-memory or a shared store
(operability, not correctness).

**Failure modes.** Bad/again auth → 401; over budget → 429; malformed body → 400
(`validation_error`); core errors pass through their typed status. The surface never invents
business errors.

**Observability.** One structured log line per request (tenant, route, outcome, latency,
correlation id); OTel server span; counters per outcome code.

**Contracts consumed.** `Executor` API; `Identity` (resolve tenant); `Catalog` (for `/tools`);
error taxonomy from `@conduit/contracts`.
**Contracts produced.** The REST HTTP contract (OpenAPI), itself defined from `@conduit/contracts`.

---

### MCP Server

**Responsibility.** Expose the catalog and executor over the Model Context Protocol so any MCP
client gets conduit's actions as native tools.

**Internal structure.** A Next.js route handler (`app/api/mcp/route.ts`) hosting the MCP
Streamable-HTTP transport via the MCP adapter (stdio entrypoint for local dev); MCP method
handlers (`initialize`, `tools/list`, `tools/call`); session→end-user binding; auth (OAuth 2.1
per MCP). `tools/list` ← `Catalog` export; `tools/call` ← `Executor.execute`.

**State.** Per-session context (authenticated principal, bound `end_user_id`); no business state.

**Failure modes.** Protocol errors per MCP; a `tools/call` failure maps the executor's typed
error into an MCP tool error result; auth failure rejects the session.

**Observability.** Per-call structured log + OTel span; session lifecycle events.

**Contracts consumed.** `Executor` API; `Catalog` export; `Identity`; MCP spec [SPEC R2].
**Contracts produced.** The MCP tool surface (tool names = action names, `inputSchema` = action
input JSON Schema).

---

### Catalog

**Responsibility.** Be the single source of "what actions exist and their shapes", loaded and
validated once, and emit tool definitions in the formats agents need.

**Internal structure.** Loader (reads declarative action JSON: built-in seed + optional
runtime override, exactly like credvault providers); validator (rejects malformed actions at
startup, fail-fast); lookup (`get(name)`); exporters (JSON Schema, OpenAI `tools`, Anthropic
`input_schema`).

**State.** An immutable in-memory registry built at startup. Invariant: every action validates
(name `<provider>.<verb>`, input/output schema present, request template references only
declared args, declared provider host is well-formed).

**Failure modes.** Invalid catalog → process fails to start (never a partial registry). Unknown
action at lookup → `validation_error` to caller.

**Observability.** Startup log of loaded action count + names; export served read-only.

**Contracts consumed.** `ActionSpec` schema from `@conduit/contracts`.
**Contracts produced.** `ActionSpec` lookup + `ToolDefinition` exports (consumed by both surfaces
and the executor).

---

### Executor

**Responsibility.** Sequence a single action execution end-to-end and own the typed-error
contract for every failure point.

**Internal structure.** `execute()` orchestrating: idempotency check → arg validation (via
Catalog schema) → token resolution (Credvault Client) → request render + invoke (Provider
Invoker) → normalization → record. Each step returns `Result<_, ConduitError>`; no step
throws across the boundary.

**State.** None of its own; reads/writes go through Execution Records and the clients.

**Failure modes.** Maps each step's failure to the closed error set (FR-5): arg→`validation_error`,
no connection→`not_connected`, provider 4xx/5xx→`provider_error`, timeout→`upstream_timeout`,
rate→`rate_limited`, anything else→`internal` (with detail logged, never returned).

**Observability.** One execution span with child spans per step (token, provider, normalize);
structured outcome log feeding the audit record.

**Contracts consumed.** `Catalog`, `CredvaultClient`, `ProviderInvoker`, `ExecutionRecords`.
**Contracts produced.** `Executor.execute` input/output (`ExecuteRequest` → `ExecuteResult |
ConduitError`) — the central contract both surfaces depend on.

---

### Credvault Client

**Responsibility.** Be the only seam to credvault; turn `(tenant, end_user_id, provider)` into
a valid access token or a typed "not connected".

**Internal structure.** Typed HTTP client over credvault's API (`GET /v1/credentials/:provider`),
authenticated with the tenant's credvault key (from Identity); maps credvault responses/errors
to conduit's taxonomy; per-request correlation header propagation.

**State.** None (the credvault tenant key is supplied per call from Identity, not cached as
mutable state).

**Failure modes.** credvault 404→`not_connected`; 5xx/timeout→`provider_error`/`upstream_timeout`
attributed to the credential hop; never leaks credvault internals.

**Observability.** Child span "credvault.token"; latency + outcome; the token value is never
logged (treated as a secret).

**Contracts consumed.** credvault HTTP API (the pinned typed client in `@conduit/contracts`).
**Contracts produced.** `TokenResolver` interface (mockable for executor tests).

---

### Provider Invoker

**Responsibility.** Perform the single SSRF-safe outbound provider call from a rendered request
template, with a bounded timeout, returning the raw response.

**Internal structure.** Template renderer (`{arg}` interpolation into method/url/headers/query/
body); URL validator (https-only, host ∈ action's declared hosts, non-internal IP — reuses
credvault's `validate_endpoint`/`is_global_ip` logic, reimplemented in TS); HTTP client with
timeout + bounded retry on idempotent methods only.

**State.** None.

**Failure modes.** Validation fail → `internal` (fail closed, no call); provider non-2xx →
surfaced with status for the executor to map to `provider_error`; timeout → `upstream_timeout`.

**Observability.** Child span "provider.call" with method, host (not full URL with secrets),
status, latency.

**Contracts consumed.** `ActionSpec.request` + `ActionSpec.providerHosts` from `@conduit/contracts`.
**Contracts produced.** `ProviderInvoker.call` interface (mockable).

---

### Identity & Tenancy

**Responsibility.** Authority for "who is this caller and which credvault tenant are they",
without ever accepting a tenant id from the request.

**Internal structure.** API-key issuance (returns key once, stores SHA-256 hash — same posture
as credvault tenants); key→tenant resolution; tenant→credvault-tenant-key mapping (the project
binding, FD-1).

**State.** Postgres: `tenants(id, name, api_key_hash, credvault_tenant_ref, created_at)`. The
credvault tenant *key* itself is a mounted secret, referenced — not stored in plaintext.

**Failure modes.** Unknown/invalid key → 401 at the surface; missing credvault binding →
`internal` (misconfiguration, logged).

**Observability.** Auth outcome counter; no key material logged.

**Contracts consumed.** none (leaf, over Postgres).
**Contracts produced.** `TenantPrincipal` (id + credvault binding) consumed by surfaces, Executor,
Credvault Client.

---

### Execution Records

**Responsibility.** Durably record what executed (audit) and enforce idempotency.

**Internal structure.** Audit writer (`audit(tenant, end_user_id, action, outcome, started_at,
latency_ms)`); idempotency store (`get/put(tenant, key) → stored ExecuteResult`, with retention
≥ 24h, NFR-DUR-2). Postgres tables with the tenant in the key for isolation.

**State.** Postgres: `executions(...)` append-only audit; `idempotency(tenant, key, result_json,
expires_at)`.

**Failure modes.** Audit write failure is logged and (per NFR-DUR-1, at-least-once) retried/
surfaced; idempotency races resolved by a unique `(tenant, key)` constraint (insert-or-read).

**Observability.** Audit *is* the execution observability of record; metrics on idempotency
hit-rate.

**Contracts consumed.** `ExecuteResult`, `ConduitError`, `TenantId` from `@conduit/contracts`.
**Contracts produced.** `AuditSink` + `IdempotencyStore` interfaces (mockable).

## Cross-cutting concerns

### Authentication and authorization

Tenant derived server-side from the credential (REST bearer hash / MCP OAuth subject), never
from the request body (NFR-SEC-1, OWASP API1 BOLA). `end_user_id` is passed by the caller and
flows unchanged to credvault, which enforces per-end-user isolation. conduit adds no
provider-scope policy in v1 beyond tenant isolation (NG-4).

### Logging, metrics, tracing

Structured JSON logs, one line per request, secret-free (NFR-OBS-1). OpenTelemetry traces span
surface → executor → {credvault, provider} with a propagated correlation id (NFR-OBS-2).
Per-outcome counters.

### Configuration

Twelve-Factor env (SPEC R12). Secrets (the credvault tenant key, DB URL) via the `*_FILE`
convention, matching credvault. Catalog source = built-in seed + optional `CONDUIT_ACTIONS_FILE`
/ `CONDUIT_ACTIONS_JSON` override (mirrors credvault's provider override).

### Versioning and compatibility

`@conduit/contracts` is semver-versioned and frozen (Phase 4); breaking changes need a major
bump + amendment branch. Surfaces and core deploy independently but must depend on a compatible
contracts version. The catalog is independently versioned data.

## Architecture decision records

### ADR-001: Two thin surfaces over one core
- **Context:** v1 needs REST and MCP; both expose the same actions.
- **Decision:** REST Gateway and MCP Server are transport adapters; all logic lives in the
  Executor/Catalog core. Surfaces hold no business logic.
- **Consequences:** no duplicated execution logic; a third surface (e.g. gRPC) is additive;
  surfaces are trivially testable.

### ADR-002: credvault consumed over HTTP, not embedded
- **Context:** credvault is Rust; conduit is TS.
- **Decision:** depend on credvault's HTTP API via one isolated `CredvaultClient`; pin the
  contract with a typed client + live e2e.
- **Consequences:** clean language boundary; independent scaling/versioning; one mockable seam.

### ADR-003: Actions are declarative data (FD-2)
- **Context:** breadth of integrations must not mean breadth of code paths.
- **Decision:** actions are validated JSON (schemas + request template + normalization),
  loaded like credvault providers.
- **Consequences:** adding an action is a data edit; the engine is written once; catalog is
  pure and testable. Cost: a templating/normalization mini-language to design in contracts.

### ADR-004: TypeScript stack, Zod as the contract source of truth
- **Context:** TS core (chosen); we need both static types and JSON Schema (for tool defs).
- **Decision:** Zod schemas in `@conduit/contracts` emit `z.infer` types and JSON Schema.
- **Consequences:** one definition drives validation, types, and LLM tool schemas; no drift.

### ADR-005: Surfaces on Next.js (latest, v16) App Router; DB access = Kysely
- **Context:** need a web layer for REST + MCP (Streamable HTTP) and typed SQL without ORM
  magic, consistent with the existing `examples/taskflow` (Next.js 16) and the team's stack.
- **Decision:** a single **Next.js (latest)** app hosts both surfaces as App Router route
  handlers — REST under `app/api/v1/*/route.ts`, the MCP server under an `app/api/mcp` route
  handler using the MCP Streamable-HTTP adapter — and the operator/dashboard UI. **All business
  logic stays in framework-agnostic packages** (`@conduit/core`, `@conduit/catalog`,
  `@conduit/contracts`); route handlers are the thin adapters (ADR-001 holds). Node runtime
  (not Edge) for pg + outbound provider calls. Kysely for thin, typed SQL over `pg`.
- **Consequences:** one deployable app (REST + MCP + UI); deploy to Vercel or self-host
  (`next start` / standalone). One web stack across the repo. Surfaces must not import server
  internals into client components (reuse the `import 'server-only'` discipline from taskflow).
  Cost: Next.js owns routing/runtime, so the "third surface = additive" property (ADR-001) is
  within Next's model. MCP adapter library pinned in CONTRACTS/PLAN.

### ADR-006: Egress SSRF control concentrated in the Provider Invoker
- **Context:** action authors must not be able to target internal/metadata hosts.
- **Decision:** all provider egress passes one validator (https, declared-host allowlist,
  non-internal IP), reusing credvault's proven logic, ported to TS.
- **Consequences:** a single audited choke point; an action template cannot bypass it.

### ADR-007: conduit owns a separate Postgres (audit, idempotency, tenants)
- **Context:** conduit has its own persistence needs distinct from credvault's secret store.
- **Decision:** a separate conduit database; no provider tokens ever stored in it.
- **Consequences:** clean blast-radius separation; conduit can be wiped/migrated without
  touching credentials.

---

## Confidence gate

```
Confidence: high
Residual risks:
  - The action templating + normalization mini-language (ADR-003) is the most novel surface;
    its exact shape is a CONTRACTS-phase design task and could reveal expressiveness gaps
    (e.g. pagination, multi-step actions) — bounded by keeping v1 seed actions single-call.
  - The MCP Streamable-HTTP adapter for Next.js route handlers (ADR-005) must be pinned to a
    specific library + version at Phase 6 and verified against the current MCP spec revision.
Known gaps:
  - None blocking. Rate-limit store (per-instance vs shared) is an operability detail deferred
    to PLAN, not a boundary question.
```

High: component boundaries are defensible and each component's produced/consumed contracts are
explicit, which is what Phase 4 needs. Proceed to commit `docs: architecture`, tag `sad/v0.1.0`.
