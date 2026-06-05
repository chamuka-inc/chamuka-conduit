# Specification

> Scope: the **v1 core slice** of conduit (see North star below for the full platform).
> Every non-obvious claim, threshold, or constraint traces to a citation or an explicit
> "chosen because" rationale. Numbers without provenance are guesses, not specifications.
>
> Confirmed scope: v1 core slice + foundational defaults FD-1..3 (user-approved). The
> deferred capabilities (6, 9, framework SDKs, full policy engine) are out of scope — see
> Non-goals.

## Problem statement

Developers building AI agents must today implement, secure, and maintain per-app OAuth
flows, API clients, credential storage, and response handling for every integration their
agent touches. **conduit** removes that work: it exposes, for any connected app, a set of
typed **tools** an agent can discover and **execute on behalf of a named end-user** —
resolving the credential through credvault, calling the provider, and returning a normalized
result or a typed error. The agent's developer handles no credentials and writes no
app-specific integration code.

## North star — full capability map

The complete platform is nine capabilities. credvault provides capability 1; conduit is 2–9.
This map is the touchstone; the v1 slice is carved from it.

| # | Capability | Definition | Disposition |
|---|------------|------------|-------------|
| 1 | **Connections (auth)** | Per-end-user OAuth/API-key links; encryption at rest; refresh; "valid token for user U at provider P". | **Built — credvault** |
| 2 | **Action catalog** | Declarative per-app action defs: input/output schema, request template, auth binding, normalization. Data, not code. | **v1 core** |
| 3 | **Execution engine** | `(tenant, end_user, action, args)` → validate → token via credvault → render → execute → normalize → typed result/error. | **v1 core** |
| 4 | **Tool discovery** | Actions as function-callable tool defs (JSON Schema → OpenAI/Anthropic formats). | **v1 core** |
| 5 | **Agent surfaces** | REST API + MCP server. Framework SDKs later. | **v1 core: REST + MCP** |
| 6 | **Triggers / webhooks** | Inbound provider events → normalize → dispatch. | Deferred |
| 7 | **AuthZ & policy** | Tenant isolation; audit log; (full per-tool policy later). | Partial in v1 |
| 8 | **Observability & ops** | Logs, traces, rate limits, quotas, replay. | Baseline in v1 |
| 9 | **Catalog tooling** | Versioned catalog, custom actions, OpenAPI import. | Deferred |

## v1 core slice (frozen scope)

Declarative action catalog (2) · execution engine (3) · tool discovery (4) · REST + MCP
surfaces (5) · tenant isolation + audit (7, partial) · observability baseline (8).

### Foundational defaults (confirmed)

- **FD-1 — tenancy:** conduit owns/provisions credvault tenants; one conduit project ↔ one
  credvault tenant. The agent never sees a credvault key.
- **FD-2 — catalog format:** declarative JSON per action — input/output schema (Zod →
  JSON Schema [R7]), an HTTP request template with `{arg}` interpolation, and a
  response-normalization mapping. No per-action code paths.
- **FD-3 — response envelope:** every action returns `{ data, raw }` — `data` is validated
  against the action's output schema; `raw` is the provider's untouched response.

## Functional requirements

> Each FR is testable. "Provider" = the upstream app (GitHub, Slack…). "Caller" = the agent
> authenticated by a conduit API key; its tenant is derived server-side, never sent.

- **FR-1 — Declarative catalog.** conduit loads an action catalog where each action declares:
  `name` (`<provider>.<verb>`), `provider`, `input_schema`, `output_schema`, an HTTP
  `request` template (method, URL template, header/query/body templates with `{arg}`
  interpolation), and a `normalize` mapping (dotted paths → output fields). An invalid
  catalog fails fast at startup, never at first request.
  - *Source / rationale:* mirrors credvault's validated providers-as-data (`src/providers`),
    which proved a declarative catalog removes per-integration code paths. FD-2.
- **FR-2 — Seed catalog.** v1 ships at least: `github.get_authenticated_user` (read),
  `github.create_issue` (write), `github.list_repositories` (read), `slack.post_message`
  (write). Each carries complete input/output JSON Schema.
  - *Source / rationale:* GitHub `GET /user`, `POST /repos/{owner}/{repo}/issues`,
    `GET /user/repos` [R8]; Slack `chat.postMessage` [R9]. GitHub is already live in credvault;
    Slack requires its own OAuth app (provisioned like GitHub was).
- **FR-3 — Tool discovery.** `GET /tools` returns each action as a tool definition whose
  parameters are the action `input_schema` as JSON Schema, and supports export shaped for
  OpenAI `tools` [R5] and Anthropic `tool use` `input_schema` [R6]. Exported schemas validate
  against those vendors' documented tool-definition shapes.
  - *Source:* OpenAI function calling [R5]; Anthropic tool use [R6]; JSON Schema 2020-12 [R7].
- **FR-4 — Execute.** `POST /execute {action, end_user_id, args}` performs, in order:
  (a) validate `args` against `input_schema`; (b) resolve a valid token from credvault for
  `(tenant, end_user_id, provider)`; (c) render the provider request from the template + args;
  (d) execute with a bounded timeout; (e) normalize the response to `{ data, raw }` with
  `data` validated against `output_schema`; (f) return a typed result. A failure at any step
  short-circuits to a typed error (FR-5) without advancing.
  - *Source / rationale:* FD-3; credvault `GET /v1/credentials/:provider` for step (b).
- **FR-5 — Typed errors.** Every failure maps to a stable error `{ code, message, status }`
  from a closed set: `validation_error` (400), `not_connected` (409), `provider_error`
  (502 + provider status echoed), `upstream_timeout` (504), `rate_limited` (429),
  `internal` (500). No credential/DB detail leaks in any error.
  - *Source / rationale:* credvault's typed-error → stable-HTTP-status posture (`src/error.rs`);
    HTTP status semantics per RFC 9110 [R1].
- **FR-6 — Token resolution via credvault.** Step (b) calls credvault with the project's
  credvault tenant key; a `404` (no connection) becomes `not_connected` and **no provider
  call is attempted**. conduit never stores provider tokens.
  - *Source / rationale:* FD-1; credvault credentials endpoint contract.
- **FR-7 — Idempotency.** `/execute` accepts an optional `Idempotency-Key`. A repeated key
  within the retention window returns the stored result and does **not** re-invoke the
  provider; keys are scoped per tenant.
  - *Source / rationale:* IETF Idempotency-Key header draft [R3]; Stripe idempotent requests
    as prior art [R4]. Side-effecting actions (e.g. `create_issue`) must be safe to retry.
- **FR-8 — MCP surface.** An MCP server exposes each action as an MCP tool (`name`,
  `description`, `inputSchema` = action input JSON Schema); `tools/list` and `tools/call` map
  to FR-3 and FR-4. End-user identity is bound per authenticated MCP session, not taken from
  tool arguments.
  - *Source:* Model Context Protocol specification — Tools and Transports [R2].
- **FR-9 — Multi-tenancy.** conduit issues per-caller API keys; each maps to exactly one
  credvault tenant. `end_user_id` flows through to credvault unchanged. A caller cannot name
  or reach another tenant (no tenant id is accepted from the request).
  - *Source / rationale:* FD-1; OWASP API1:2023 BOLA mitigation [R10].
- **FR-10 — Audit log.** Every `/execute` attempt records `(tenant, end_user_id, action,
  outcome_code, started_at, latency_ms)` — never secrets or token material.
  - *Source / rationale:* capability 7 (partial); supports incident review and per-tenant usage.
- **FR-11 — SSRF-safe rendering.** A rendered provider URL must match the action's declared
  provider host(s), be `https`, and not resolve to a loopback/private/link-local/metadata
  address; violations fail closed as `internal` before any network call.
  - *Source:* OWASP API7:2023 SSRF [R10]; OWASP SSRF Prevention Cheat Sheet [R11]; reuses
    credvault's endpoint validation (`validate_endpoint`, `is_global_ip`).

## Non-functional requirements

### Performance

- **NFR-PERF-1:** conduit-internal execution overhead — argument validation + request
  render + response normalization, **excluding** the credvault and provider round-trips —
  has p99 ≤ **50 ms** for request+response payloads ≤ 256 KB.
  - *Source:* chosen because this work is in-process CPU/JSON only; end-to-end latency is
    dominated by network round-trips (credvault + provider, typically 10²–10³ ms per
    RFC 9110 request semantics [R1]). The budget exists so conduit is never the bottleneck;
    256 KB bounds the JSON parse/validate cost (cf. credvault `VAULT_MAX_BODY_BYTES` 64 KB,
    relaxed here for richer payloads).
- **NFR-PERF-2:** the execution path is **stateless**; throughput scales horizontally by
  replica count.
  - *Source:* mirrors credvault's stateless `web` tier (README Architecture); Twelve-Factor
    processes [R12].

### Durability & consistency

- **NFR-DUR-1:** an audit record (FR-10) is durably persisted (Postgres) for every terminal
  `/execute` outcome, at-least-once.
  - *Source:* capability 7; Postgres as the system of record (same store as credvault).
- **NFR-DUR-2:** idempotency keys (FR-7) are retained ≥ **24 h**; within that window a repeated
  key yields exactly-once provider invocation.
  - *Source:* Stripe retains idempotency keys ~24 h [R4]; IETF draft semantics [R3].

### Security

- **NFR-SEC-1 — Tenant isolation:** the tenant is derived from the conduit API key hash
  server-side and never accepted from the request; no cross-tenant access is expressible.
  - *Threat model:* STRIDE Elevation of Privilege; OWASP API1:2023 BOLA [R10].
- **NFR-SEC-2 — SSRF defense:** enforced per FR-11 on every rendered request.
  - *Threat model:* OWASP API7:2023 SSRF [R10][R11].
- **NFR-SEC-3 — Secret handling:** conduit holds one credvault tenant key per project,
  supplied via the `*_FILE` mount convention (as credvault does); tokens fetched from
  credvault live only in memory for the single outbound call and are never logged or persisted.
  - *Threat model:* STRIDE Information Disclosure; reuses credvault's secret discipline.
- **NFR-SEC-4 — MCP authorization:** the remote MCP surface authenticates callers and binds
  an end-user context using the MCP authorization framework (OAuth 2.1-based).
  - *Source:* MCP specification — Authorization [R2]; OAuth 2.1 [R13].

### Observability

- **NFR-OBS-1:** structured JSON logs per request with a correlation id; no secrets (matches
  credvault logging).
- **NFR-OBS-2:** distributed traces spanning conduit → credvault → provider via OpenTelemetry.
  - *Source:* OpenTelemetry specification [R14].

### Operability

- **NFR-OPS-1:** per-caller rate limiting with a configurable budget (cf. credvault
  `VAULT_RATE_LIMIT_PER_MINUTE`).
- **NFR-OPS-2:** liveness/readiness endpoints and Twelve-Factor env configuration [R12].

## Non-goals (v1)

- **NG-1:** Triggers / inbound webhooks (capability 6) — *because* a new ingress + security
  surface would delay a usable core; add after the execute API is frozen.
- **NG-2:** Framework SDKs / adapters (capability 5 extension) — *because* they are thin
  clients over a stable REST/MCP contract; build once frozen.
- **NG-3:** OpenAPI import / user-defined custom actions (capability 9) — *because* a
  hand-authored seed catalog suffices to prove the engine.
- **NG-4:** Full policy engine (capability 7) — *because* tenant isolation + audit cover the
  v1 security need.
- **NG-5:** Provider-side write verification beyond the seed actions — v1 proves the engine on
  a small set, not breadth.

## Constraints

- credvault is an existing Rust service consumed over its HTTP API; its API is a fixed
  contract. conduit is TypeScript/Node.
- Monorepo: both stacks coexist; tooling must not cross the language boundary.
- Postgres is the datastore (shared operational story with credvault; separate schema/db).

## Open questions

- [x] Confirm v1 core slice + FD-1..3 — **confirmed**.
- [x] Seed actions/providers — **GitHub (3) + Slack (1)** per FR-2; Google/Gmail deferred
  (needs `gmail.send` scope; credvault default is `gmail.readonly`).
- [x] MCP transport — **Streamable HTTP** as the primary (remote) transport; **stdio** for
  local dev [R2].
- [x] Latency budget + source — **NFR-PERF-1** (chosen-because rationale).

## Glossary

- **Action / tool:** one executable provider operation (`github.create_issue`); "tool" is the
  agent-facing framing.
- **End-user:** the person an action runs for (`external_user_id` in credvault).
- **Caller / tenant:** the agent/app calling conduit, authenticated by a conduit API key.
- **Normalization:** mapping a provider's raw response to a stable, schema-validated `data`.

## References

1. **RFC 9110** — HTTP Semantics. IETF, 2022. (Status codes; idempotent methods §9.2.2.)
   https://www.rfc-editor.org/rfc/rfc9110
2. **Model Context Protocol Specification** — Tools, Transports (stdio, Streamable HTTP),
   Authorization. https://modelcontextprotocol.io/specification
3. **Idempotency-Key Header** — IETF httpapi WG draft (`draft-ietf-httpapi-idempotency-key-header`).
   https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
4. **Stripe API — Idempotent requests** (prior art; ~24 h key retention).
   https://docs.stripe.com/api/idempotent_requests
5. **OpenAI — Function calling / tools** (JSON Schema parameters).
   https://platform.openai.com/docs/guides/function-calling
6. **Anthropic — Tool use** (`input_schema` is JSON Schema).
   https://docs.anthropic.com/en/docs/build-with-claude/tool-use
7. **JSON Schema 2020-12.** https://json-schema.org/specification
8. **GitHub REST API** — `GET /user`, `POST /repos/{owner}/{repo}/issues`, `GET /user/repos`.
   https://docs.github.com/en/rest
9. **Slack Web API** — `chat.postMessage`. https://api.slack.com/methods/chat.postMessage
10. **OWASP API Security Top 10 (2023)** — API1 BOLA, API7 SSRF.
    https://owasp.org/API-Security/editions/2023/en/0x11-t10/
11. **OWASP SSRF Prevention Cheat Sheet.**
    https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
12. **The Twelve-Factor App** — Config, Processes. https://12factor.net
13. **OAuth 2.1** — IETF draft (`draft-ietf-oauth-v2-1`).
    https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/
14. **OpenTelemetry Specification.** https://opentelemetry.io/docs/specs/otel/

---

## Confidence gate

```
Confidence: high
Residual risks:
  - MCP spec is fast-moving; the Streamable HTTP transport + OAuth 2.1 auth (R2/R13) must be
    re-pinned to the exact revision at implementation time (closed in CONTRACTS phase).
  - Slack requires its own OAuth app + scopes in credvault before slack.post_message is live;
    GitHub is already proven, so the engine can be built and verified on GitHub alone first.
Known gaps:
  - None blocking. Output-schema strictness per action (reject vs. passthrough unknown
    provider fields) is a CONTRACTS-phase decision; `raw` (FD-3) preserves the escape hatch
    regardless.
```

High: scope is confirmed, every FR is testable, and every threshold/constraint is cited or
has an explicit rationale. The residual risks are implementation-time pin-downs, not scope or
feasibility unknowns. Proceed to commit `docs: specification` and tag `spec/v0.1.0`.
