# Contracts

> Prose companion to the contracts package at `conduit/packages/contracts/`. The package is
> the source of truth — Zod schemas + TypeScript types compile; prose does not. This document
> explains the *why* and the cross-cutting policies the types cannot express.

## Status

Frozen at `contracts/v0.2.0-frozen` on 2026-06-04. Changes require a
`contracts/amendment-<desc>` branch and a version bump.

**Amendments:**
- `v0.2.0` (`contracts/amendment-catalog-port`): added the `ActionCatalog` port — the
  Executor's action-lookup seam, surfaced by the Phase-5 decomposition. Additive (minor bump).

## Cross-cutting policies

### Serialization

- **Format:** JSON. Schemas are **Zod** (`zod@^4`); `z.infer` gives static types and Zod's
  native JSON-Schema emission gives the function-calling tool schemas — one definition, no drift.
- **Field naming:** conduit's own messages (`ExecuteRequest`, `ExecuteResult`, `ConduitError`,
  `ToolDefinition`) use **camelCase** (TS idiom). The one exception is `CredvaultCredential`,
  which mirrors credvault's wire shape verbatim (**snake_case**: `access_token`, `expires_at`)
  because it is the pinned upstream contract (ADR-002), not a conduit-authored message.
- **Unknown field handling:** inbound parsing **strips** unknown keys (Zod default) — forgiving
  to additive upstream/client changes. Secrets are never echoed into `details`.

### Versioning

- The contracts package is versioned independently of any consumer (currently `0.1.0`).
- Semver: breaking changes require a major bump on a `contracts/amendment-<desc>` branch;
  additive changes a minor bump.
- Closed unions that may grow (e.g. `ErrorCode`) are extended additively; adding a variant is a
  minor bump, removing/renaming one is breaking.

### Error types

- `ConduitError` carries a **stable `code`** (the `ErrorCode` enum) plus an **unstable
  `message`** and optional `details`. Consumers branch on `code`; they never parse `message`.
- `statusForCode` is the single mapping from `code` → HTTP status; both surfaces map through it.

### Newtypes over primitives

Every domain identifier is a Zod **branded** type (`TenantId`, `EndUserId`, `ActionName`,
`IdempotencyKey`) so a raw `string` cannot be passed where an id is expected — the TS-addendum
equivalent of the discipline's primitive-obsession rule.

## Contracts inventory

### `ActionSpec` (+ `RequestTemplate`, `NormalizeMapping`, `JsonSchema`, `HttpMethod`)
- **Producer:** Catalog. **Consumers:** Executor, Provider Invoker.
- **Purpose:** a single provider operation defined as data (FD-2) — schemas, request template,
  SSRF host allowlist, normalization mapping.
- **Shape:** `packages/contracts/src/action.ts`.
- **Invariants (beyond the types):** `request.urlTemplate` placeholders must reference declared
  input properties; the rendered host must be in `providerHosts` (enforced at execution, FR-11);
  `name` is `<provider>.<verb>`.
- **Compatibility:** adding optional fields is additive; changing template/normalize semantics
  is breaking.

### `ToolDefinition`
- **Producer:** Catalog. **Consumers:** Gateway, MCP Server.
- **Purpose:** the provider-agnostic, function-callable tool view of an action (FR-3).
- **Shape:** `packages/contracts/src/tools.ts`.
- **Invariants:** `inputSchema` equals the action's `inputSchema`; `name` equals the action name.

### `ExecuteRequest` / `ExecuteResult`
- **Producer:** surfaces build the request; Executor produces the result. **Consumers:** Executor
  consumes the request; surfaces + Idempotency store consume the result.
- **Purpose:** the central execute contract (FR-4); `ExecuteResult` is the `{ data, raw }`
  envelope (FD-3).
- **Shape:** `packages/contracts/src/execute.ts`.
- **Invariants:** `data` validates against the action's `outputSchema` (enforced by Executor).

### `ConduitError` / `ErrorCode` / `statusForCode`
- **Raised by:** every core component. **Observed by:** surfaces, audit, callers.
- **Kinds:** `validation_error`(400) · `not_connected`(409) · `provider_error`(502) ·
  `upstream_timeout`(504) · `rate_limited`(429) · `internal`(500).
- **Retry guidance:** `upstream_timeout` and `rate_limited` are retryable (honor backoff);
  `validation_error`, `not_connected` are terminal for the same input; `provider_error` depends
  on the echoed provider status; `internal` is not caller-retryable.
- **Shape:** `packages/contracts/src/errors.ts`.

### `CredvaultCredential` / `AccessToken`
- **Producer:** Credvault Client (from credvault's HTTP response). **Consumers:** Executor,
  Provider Invoker.
- **Purpose:** the pinned credvault response shape (ADR-002) and the in-memory token for one
  outbound call.
- **Shape:** `packages/contracts/src/credvault.ts`.
- **Invariants:** `accessToken` is secret-bearing — never logged or persisted (NFR-SEC-3).

### Ports — `ActionCatalog`, `TokenResolver`, `ProviderInvoker`, `AuditSink`, `IdempotencyStore`, `TenantPrincipal`, `RenderedRequest`, `AuditEntry`
- **Purpose:** the mockable seam interfaces between components so the Executor is testable
  against mocks (Phase 6 e2e-mock) before live peers.
- **Shape:** `packages/contracts/src/ports.ts`.

### `Result<T, E>` and branded ids
- **Purpose:** explicit success/failure across boundaries (no throwing); typed identifiers.
- **Shape:** `packages/contracts/src/result.ts`, `packages/contracts/src/ids.ts`.

## Component-to-contract matrix

| Component | Produces | Consumes |
|-----------|----------|----------|
| **Catalog** | `ActionCatalog`, `ToolDefinition` | `ActionSpec` (schema) |
| **Executor** | `ExecuteResult`, `ConduitError` | `ActionCatalog`, `ExecuteRequest`, `TokenResolver`, `ProviderInvoker`, `AuditSink`, `IdempotencyStore` |
| **Credvault Client** | `AccessToken`, `TokenResolver` | `CredvaultCredential`, `TenantPrincipal` |
| **Provider Invoker** | `ProviderInvoker` impl | `ActionSpec`, `RenderedRequest`, `AccessToken` |
| **Identity & Tenancy** | `TenantPrincipal` | `TenantId` |
| **Execution Records** | `AuditSink`, `IdempotencyStore` impls | `AuditEntry`, `ExecuteResult`, `ConduitError` |
| **Gateway (REST)** | REST HTTP contract | `ExecuteRequest`, `ExecuteResult`, `ConduitError`, `ToolDefinition`, `TenantPrincipal` |
| **MCP Server** | MCP tool surface | `ToolDefinition`, `ExecuteRequest`, `ExecuteResult`, `ConduitError`, `TenantPrincipal` |

Every SAD component appears with both columns populated — the per-component zoom and the package
agree.

## Freeze gate

- [x] Confidence self-assessment is "high" with gaps resolved
- [x] `conduit/packages/contracts/` typechecks cleanly (`tsc --noEmit`, strict)
- [x] Every component in `SAD.md` has its produced and consumed contracts represented
- [x] The component-to-contract matrix matches the package
- [x] Tests pass (`vitest run` — 8 passing) and lint is clean

```
Confidence: high
Residual risks:
  - JsonSchema is typed permissively (a record); a malformed action schema is caught by the
    catalog loader and at arg-validation time, not by the contract type. Acceptable: the
    schema is data, validated at load (FR-1).
  - The action templating/normalization semantics (placeholder + dotted-path) are specified in
    prose here; their executable behavior is pinned by tests in the catalog/executor modules
    (Phase 6), not by the contract types.
Known gaps:
  - None blocking. Identity's API-key issuance shape (caller-facing) is an internal surface
    detail, intentionally not a cross-component contract.
```

High: the package typechecks in isolation, every cross-component seam is a named type, and the
matrix is consistent with the SAD. Proceed to commit `docs: contracts` and tag
`contracts/v0.1.0-frozen`.
