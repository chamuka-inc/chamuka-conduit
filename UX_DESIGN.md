# conduit — Production UX Design

> The human-facing design for conduit (the agent tool/action execution platform) and the parts of
> credvault (the credential layer) that users touch. conduit's *machine* surfaces (REST, MCP) are
> specified in `SPEC.md`/`SAD.md`; this document specifies the **human** surfaces and the flows that
> connect them. It is provider-agnostic by construction: every provider quirk is absorbed by a
> **data-driven connection model**, never hardcoded per service.
>
> Status: design (pre-implementation). Bridges to code in §10.

## 1. User types (personas)

| # | Persona | Goal | Touches | Auth |
|---|---------|------|---------|------|
| 1 | **Operator** (platform admin) | Stand up & run the platform | Operator console | Platform SSO (admin) |
| 2 | **Developer** (tenant owner) | Build an agent on conduit | Developer dashboard | Dashboard login (SSO/email) |
| 3 | **End-user** | Let an agent act on *their* accounts | Connection portal (hosted or embedded) | No conduit account — a short-lived **Connect Session Token** minted by the developer |
| 4 | **MCP client + its human** | Use conduit's tools from an MCP client (Claude, etc.) | MCP consent screen (OAuth `/authorize`) | OAuth 2.1; human authenticated at consent |

The non-obvious one is the **end-user**: they never get a conduit login. The developer's backend asks
conduit (with its tenant API key) for a **Connect Session Token** scoped to one `end_user_id`, and
drops the user into the portal (hosted redirect or embedded widget) with that token. This is the
Nango/Composio "connect link" pattern and keeps end-users out of conduit's account system.

### 1.1 These are four separate apps — not one app with four tabs

Each surface is a **distinct application/deployment with its own domain, auth, and trust tier**. There
is **no shared navigation**: a user of one surface cannot navigate into another. (The mockups under
`design/` reflect this — four standalone files, `portal.html` / `dashboard.html` / `console.html` /
`mcp-consent.html`, sharing only `conduit-ds.css`; `index.html` is a developer gallery, not a product
surface.) Separating the deployments is also blast-radius hygiene: a bug in the public end-user portal
must not be able to reach operator controls (same separation ethos as ADR-007).

| Surface | User | App / domain | Auth | Trust tier | Can reach |
|---|---|---|---|---|---|
| Connection portal | end-user | embedded widget **or** `connect.conduit.app/s/<token>` | Connect Session Token (no account) | **lowest** — one `end_user_id` | only *their own* connections, only the providers the developer enabled |
| Developer dashboard | tenant owner | `app.conduit.app` | dashboard login (SSO/email), tenant-scoped | **tenant** | one tenant's keys, tools, users, audit |
| Operator console | platform admin | `admin.conduit.app` (internal, SSO + role/IP-gated) | platform SSO + admin role | **highest** — all tenants, provider secrets | everything, incl. dangerous/global controls |
| MCP consent | the human behind an MCP client | `vault.conduit.app/oauth/authorize` (transient interstitial) | OAuth 2.1; human authenticated for the session | **per-session** | grants one client a scoped, end-user-bound token — nothing else |

Practically: the **portal** ships as an embeddable widget + a thin hosted page (no conduit branding
required); the **dashboard** and **console** are separate authenticated SPAs (the console likely a
separate internal deployment); the **consent screen** is a single stateless page in the OAuth flow.
They may share a design system and component library, but not a shell, a session, or a deployment.

## 2. Design principles

1. **Provider-agnostic, data-driven.** No screen hardcodes "GitHub" or "Slack". A **Provider
   Descriptor** (auth type, scopes, fields, branding, health rules) renders every connect surface.
   Adding a provider = adding a descriptor + a catalog action, never a new screen.
2. **Credentials are never shown or handled by conduit UIs.** OAuth happens in the provider's own
   consent screen; API keys are entered into a field that posts straight to credvault and is never
   echoed. conduit surfaces show *connection state*, never token material (NFR-SEC-3).
3. **State honesty.** Every connection has an explicit, visible lifecycle state; the UI never implies
   "connected" when a token is expired or a needed scope is missing.
4. **Two delivery modes, one component.** The same connection UI ships as a conduit-hosted page *and*
   an embeddable widget/SDK. Build once, render in both.
5. **Progressive disclosure by persona.** Operators see global/dangerous controls; developers see
   their tenant; end-users see only their own connections and only the providers the developer enabled.

## 3. The connection model (the heart — where provider quirks live)

### 3.1 Provider Descriptor (the adaptive schema)

A single typed descriptor per provider drives all connect UI. (New contract — see §10.)

```jsonc
{
  "provider": "slack",
  "displayName": "Slack",
  "logoUrl": "…", "brandColor": "#4A154B",
  "auth": {
    "type": "oauth2",                 // "oauth2" | "api_key" | "basic" | "none"
    "scopesByCapability": {            // action → scopes it needs (drives incremental consent)
      "slack.post_message": ["chat:write"]
    },
    "supportsMultipleAccounts": true   // can a user connect >1 workspace?
  },
  // for api_key/basic providers instead of oauth2:
  "fields": [
    { "key": "apiKey", "label": "API key", "secret": true, "help": "Settings → API",
      "pattern": "^xoxb-", "docsUrl": "…" }
  ],
  "accountLabelHint": "workspace"      // what one "account" means for this provider
}
```

This absorbs the quirks: **OAuth vs API-key vs basic** (which connect affordance to show), **scopes
per action** (what to request / when to re-consent), **multiple accounts** (workspace/org pickers),
**field shapes** (key format, where to find it), and **branding**.

### 3.2 Connection lifecycle (the state machine the UI renders)

```
  ┌───────────────┐  connect    ┌────────────┐  provider grant  ┌───────────┐
  │ not_connected │ ─────────▶ │ connecting │ ───────────────▶ │ connected │
  └───────────────┘             └────────────┘                  └─────┬─────┘
        ▲  ▲                          │ user cancels / error            │ token expires (no refresh)
        │  └──────────────────────────┘                                 ▼
        │                                                          ┌──────────┐
        │ disconnect / revoke                              reauth  │ expired  │
        └──────────────────────────────────◀───────────────┐      └────┬─────┘
                                                            │           │ action needs a new scope
                                                       ┌────┴───────────▼────┐
                                                       │   needs_reauth      │  (credvault 409)
                                                       └─────────────────────┘
```

Mapping to credvault/conduit responses (so the UI never guesses):

| Backend signal | UI state | Affordance shown |
|---|---|---|
| no record (credvault 404) | `not_connected` | **Connect** |
| token valid | `connected` | account label, scopes, **Manage / Disconnect** |
| token expired, no refresh | `expired` | **Reconnect** (amber) |
| 409 needs re-authorization / missing scope | `needs_reauth` | **Re-authorize** (amber) + which new scope & why |
| revoked upstream / by user | `revoked` | **Reconnect** |

`needs_reauth` is the subtle one: an action (`slack.post_message`) requires `chat:write`; if the
user's existing connection lacks it, the **execute** path returns `not_connected`/needs-reauth and the
portal must request the *delta* scope with a clear "why" — not silently fail.

### 3.3 Two delivery modes

- **Hosted portal** — `connect.conduit.app/s/<sessionToken>` (or self-host path). The developer
  redirects the user here; on completion conduit redirects back to the developer's `returnUrl`.
- **Embeddable widget** — `@conduit/connect` SDK: `conduit.openConnect({ sessionToken })` opens a
  modal/iframe; events (`connected`, `error`, `closed`) post back to the host app. Same React
  components as the hosted page, themeable via the descriptor's brand + developer theme overrides.

Both are backed by the same conduit endpoints; the only difference is chrome (full page vs modal).

## 4. Surface A — End-user Connection Portal  *(highest-value, quirk-heavy)*

**Entry:** a Connect Session Token (one `end_user_id`, a `returnUrl`, an allowed-provider set).
**Goal:** connect/repair the accounts the agent needs, with zero conduit account.

### 4.1 Connections list (hosted)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ◤ Acme Copilot  ·  connecting accounts for  alice@acme.com           │
│─────────────────────────────────────────────────────────────────────│
│  Connect your tools so Acme Copilot can act on your behalf.           │
│                                                                       │
│   GitHub        ● Connected   @swiftugandan · repo, read:user         │
│                 ───────────────────────────────────  [ Manage ▾ ]     │
│                                                                       │
│   Slack         ⚠ Re-authorize needed                                 │
│                 Posting messages needs the “chat:write” permission.   │
│                 ───────────────────────────────────  [ Re-authorize ] │
│                                                                       │
│   Linear        ○ Not connected   (API key)                           │
│                 ───────────────────────────────────  [ Connect ]      │
│                                                                       │
│   Notion        ⏳ Expired   reconnect to keep automations running    │
│                 ───────────────────────────────────  [ Reconnect ]    │
│                                                                       │
│                                          [ Done ]  → back to Acme      │
└─────────────────────────────────────────────────────────────────────┘
```

Each row is one `<ProviderConnectCard descriptor state account>`. The list shows **only** providers
the developer enabled for the tenant, and the auth affordance adapts to the descriptor.

### 4.2 OAuth connect (the redirect dance, made legible)

```
[ Connect ] →  conduit creates a connect intent, redirects to provider consent
            →  GitHub: "Acme Copilot wants access to: repositories, profile"  [Authorize]
            →  provider → credvault callback (token stored) → portal
            →  row flips to ● Connected with the granted scopes
```

UI states during: button → spinner ("Opening GitHub…") → (popup or full redirect) → success toast or
inline error (`connecting` → `connected`/`not_connected`). Embedded mode uses a popup so the host app
isn't navigated away; hosted mode uses full redirect.

### 4.3 API-key connect (key-based providers, e.g. Linear/OpenAI)

```
┌──────────────── Connect Linear ────────────────┐
│  Linear uses an API key.                        │
│  API key  [ •••••••••••••••••••••• ] (paste)    │   ← masked, never echoed back
│  Where do I find this?  → Linear ▸ Settings ▸ API│
│  We store it encrypted in the vault; conduit     │
│  never logs or displays it.                      │
│                         [ Cancel ]  [ Save key ] │
└──────────────────────────────────────────────┘
```

The field posts directly to credvault; the descriptor's `pattern`/`docsUrl`/`help` drive validation
and guidance. Same card, different body — driven by `auth.type`.

### 4.4 Manage / multiple accounts / disconnect

```
GitHub  [ Manage ▾ ]
  • @swiftugandan (personal)   scopes: repo, read:user   ● healthy   [Reconnect] [Disconnect]
  • @acme-bot (org)            scopes: repo               ● healthy   [Reconnect] [Disconnect]
  + Connect another GitHub account            ← only if descriptor.supportsMultipleAccounts
```

Disconnect = confirm dialog (destructive); per the platform rules, revoking access is irreversible, so
it always confirms and never auto-fires.

### 4.5 States to design for every card
`not_connected · connecting · connected · expired · needs_reauth · revoked · error` — plus
loading skeleton and an empty state ("No tools required yet").

## 5. Surface B — Developer / Tenant Dashboard

**Auth:** dashboard login (the developer). **Scope:** one tenant. IA (left nav):

```
conduit ▸ Acme
 ├ Overview        usage, recent executions, health, error-rate
 ├ API keys        create/rotate/revoke conduit keys (shown once); scopes; last-used
 ├ Tools           the catalog: providers & actions; enable/disable per tenant; JSON-Schema view
 ├ Connections     end-users × providers matrix; health; mint Connect Links; force-reauth
 ├ MCP             the tenant's MCP URL + OAuth metadata; registered clients; copy-paste setup
 ├ Playground      “try it”: pick action + end-user → run → see {data,raw} + the audit row
 ├ Logs / Audit    filter by action/outcome/end-user/time; drill into one execution
 └ Settings        team, theme (for embedded connect), webhooks, billing/quota
```

### 5.1 Overview

```
┌ Overview ───────────────────────────────────────────────────────────┐
│  Executions (24h)  1,284   ✓ 97.4%   ⌀ 412ms      [ ▁▂▅▇▅▃▂ sparkline]│
│  By outcome   ok 1,251 · not_connected 22 · provider_error 7 · …      │
│  Connected end-users  318     Providers enabled  GitHub, Slack        │
│  ⚠ 22 executions failed not_connected — [view affected users]         │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.2 Tools (catalog, per-tenant enablement)

```
GitHub  ▸ enabled                                            [ ▾ ]
   ✓ github.get_authenticated_user     read:user
   ✓ github.create_issue               repo
   ✓ github.list_repositories          repo
Slack   ▸ enabled
   ✓ slack.post_message                chat:write    ⚠ 41 users not connected
Linear  ▸ available — [enable]         (api key)
```

Toggling an action on/off scopes what the tenant's agents can call and what end-users are asked to
connect. Each action expands to its JSON Schema (the same the LLM/MCP sees).

### 5.3 Connections matrix + Connect Links

```
End-user            GitHub      Slack       Linear
alice@acme.com      ● healthy   ⚠ reauth    ○ —          [ Connect link ⧉ ]
bob@acme.com        ● healthy   ● healthy   ● healthy    [ Connect link ⧉ ]
…                                                        [ + invite users ]
```

"Connect link" mints a Connect Session Token → copyable hosted URL or SDK snippet (this is how the
developer wires the end-user portal into their product).

### 5.4 MCP tab (turn an MCP client onto this tenant)

```
Your MCP endpoint   https://mcp.conduit.app/t/acme            ⧉
Auth                OAuth 2.1 (discovery automatic)
Add to Claude / Cursor / …   [ copy config ]   [ test connection ]
Registered clients   Claude Desktop (2 days ago) · Cursor (today)   [revoke]
```

### 5.5 Playground (try-it console)

```
Action  [ github.create_issue ▾ ]   acting for  [ alice@acme.com ▾ ]
args  { "owner":"acme", "repo":"web", "title":"Bug" }       [ Run ]
Result  200  ✓   { data:{ number:42, htmlUrl:"…" }, raw:{…} }      → audit #91af
```

## 6. Surface C — Operator Console

**Auth:** platform admin SSO. **Scope:** the whole deployment. Dangerous controls live here only.

```
conduit ▸ admin
 ├ Provider integrations   register/configure provider apps (the §"create an app per service" step)
 ├ Catalog                 global action catalog: add/validate/publish actions (fail-fast preview)
 ├ Tenants                 list/create tenants, map to credvault tenant, suspend, quotas
 ├ Observability           cross-tenant: throughput, error taxonomy, latency, SSRF blocks
 └ Platform settings       rate-limit policy, OAuth signing keys, regions
```

### 6.1 Provider integration setup (where the per-service app is registered)

```
┌ Add provider integration ──────────────────────────────────────────┐
│  Provider     [ Slack ▾ ]                                           │
│  Auth type    OAuth 2.1                                             │
│  Client ID        [ ································ ]                │
│  Client secret    [ •••••••••••••••• ]   stored in credvault only    │
│  Redirect URL     https://vault.conduit.app/oauth/callback   ⧉      │
│      → register this URL in Slack’s app settings                    │
│  Default scopes   chat:write                                        │
│  Status       ○ not configured → [ Save & verify ]                  │
└──────────────────────────────────────────────────────────────────────┘
```

This is the one-time, per-provider step (§"Does every service need an app?"). The secret is written
to credvault and never rendered back. Catalog actions for that provider stay dormant
(`not_connected`) until this is configured.

### 6.2 Catalog publish (fail-fast preview)

The loader's FR-1 fail-fast (`@conduit/catalog`) gets a UI: paste/upload an action, see it validated
(schema compiles, placeholders declared, host allowlisted) *before* publish, with red inline errors.

## 7. Surface D — MCP Auth / Consent Screen

The prod replacement for today's headless `/authorize`. An MCP client (Claude) hits the OAuth dance
(`SPEC` R2); the **human** lands here:

```
┌────────────────── Authorize MCP client ──────────────────┐
│  Claude Desktop  wants to use Acme’s tools via conduit    │
│                                                           │
│  Acting as end-user   [ alice@acme.com ▾ ]                │  ← binds end_user_id to the session
│  Granting access to                                       │
│     • github.*   (repositories, profile)                  │
│     • slack.post_message   (post messages)                │
│  Tools run with the connections alice has authorized.     │
│  Unconnected tools will prompt alice to connect.          │
│                                                           │
│             [ Deny ]              [ Authorize ]           │
└─────────────────────────────────────────────────────────┘
```

Authenticating the human here (vs today's API-key header): a developer-issued session, or the
developer's own SSO, establishes *who* and *which end-user* — then conduit issues the audience-bound
token (the flow demonstrated end-to-end already). Denial and scope display are mandatory (OAuth 2.1).

## 8. Provider-quirk → UI matrix

| Quirk | Where it shows | Driven by | UI behaviour |
|---|---|---|---|
| OAuth vs API-key vs basic | Connect affordance | `descriptor.auth.type` | redirect button / key form / user+pass form |
| Scopes per action | Catalog, consent, reauth | `scopesByCapability` | request right scopes; show "why"; delta re-consent |
| Token expiry / no refresh | Portal + dashboard | credvault token state | `expired` → Reconnect |
| Missing scope at execute | Portal | credvault 409 | `needs_reauth` with the specific scope |
| Multiple accounts | Manage menu | `supportsMultipleAccounts` | account list + "connect another" |
| Account label meaning | Connected rows | `accountLabelHint` | "workspace" (Slack) vs "@handle" (GitHub) |
| Key format / where-to-find | API-key form | `fields[].pattern/help/docsUrl` | inline validation + guidance |
| Rate limits / quota | Dashboard overview, errors | conduit `rate_limited` | quota meter + 429 surfacing |
| Provider-specific args | Playground, errors | action `inputSchema` | schema-driven form + validation_error mapping |

## 9. Cross-cutting UX

- **Design system / tokens.** One token set; the embedded widget accepts developer theme overrides +
  per-provider brand color. Core components: `ProviderConnectCard`, `StatusPill`
  (connected/expired/reauth/error), `ScopeList`, `SecretField` (masked, never echoes), `OutcomeBadge`
  (maps the closed error taxonomy → colour), `JsonSchemaForm`, `AuditRow`.
- **States everywhere.** Loading skeletons, empty states, inline errors mapped from the **closed
  error taxonomy** (validation_error→field error, not_connected→connect CTA, rate_limited→retry-after,
  provider_error/upstream_timeout→transient banner). Never a raw stack trace.
- **Security UX.** Secrets are write-only fields; tokens never displayed; scope grants always explicit
  and revocable; destructive/irreversible actions (disconnect, revoke, delete tenant, rotate keys)
  always confirm (aligns with the platform safety rules).
- **Accessibility.** WCAG AA: keyboard-navigable connect flows, status conveyed by text+icon (not
  colour alone), focus management in modals, reduced-motion honoured.
- **Responsive.** The connection portal and consent screen are mobile-first (end-users connect on
  phones); the dashboards/console are desktop-first.

## 10. What this implies for code (design → implementation bridge)

None of this is built yet; it surfaces concrete future work (post-v1, additive — slots beside the
`PLAN.md` gaps):

1. **Provider Descriptor registry** (new contract in `@conduit/contracts` + data) — the schema in §3.1;
   the single source the UI and catalog share. *Contracts amendment.*
2. **Connect Session Tokens** — conduit endpoint `POST /api/v1/connect-sessions {endUserId, providers,
   returnUrl}` → short-lived token; the hosted portal + SDK consume it. *New gateway surface.*
3. **Connection-state read API** — `GET /api/v1/connections?endUserId=` (proxying credvault state) so
   portal/dashboard render lifecycle without touching tokens. *New gateway surface + credvault state
   endpoint.*
4. **Hosted portal app** (`apps/connect` or routes in `apps/web`) + **`@conduit/connect` SDK**
   (embeddable widget). Shared React components from the descriptor.
5. **Operator console + developer dashboard** (grows the current minimal `/` read-only view into the
   authenticated multi-tenant dashboard in §5; operator console in §6).
6. **MCP consent screen** — replace the headless `/authorize` with §7, plus human auth.
7. **credvault additions** — provider-app config storage, connection-state read, scope-delta detection
   (the `needs_reauth` signal).

Build order suggestion (each its own `module/`): Provider Descriptor (contract) → connection-state +
connect-session APIs → connection portal (hosted) → `@conduit/connect` SDK → developer dashboard →
MCP consent → operator console. The end-user **connection portal** is the highest-leverage first slice
because it's where every provider quirk converges.
