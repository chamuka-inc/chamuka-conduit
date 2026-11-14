# Contributing to conduit

Thanks for your interest in improving conduit. This document describes how to get set
up, what the project expects from a change, and how to get it merged.

conduit is the action/integration layer for AI agents and applications. It turns
third-party SaaS APIs into callable, schema-typed actions. It deliberately does **not**
store credentials — token storage, refresh, and rotation are delegated to
[credvault](https://github.com/chamuka-labs/credvault). Keep that boundary intact.

## Code of Conduct

This project adheres to the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating,
you are expected to uphold it.

## Reporting security issues

**Do not file public issues for vulnerabilities.** Follow the private disclosure process
in [SECURITY.md](SECURITY.md).

## Getting started

You need **Node.js ≥ 20** and [pnpm](https://pnpm.io). conduit is a pnpm **monorepo** —
run all commands from the repo root. A running credvault instance is only required for
the live test suites and to actually execute actions; `pnpm verify` stays offline.

```bash
git clone https://github.com/chamuka-labs/conduit
cd conduit

pnpm install
pnpm verify          # typecheck + lint + Vitest (offline; live suites are gated off)
```

To run the Next.js operator app locally:

```bash
cd apps/web
cp .env.example .env.local   # then fill in CONDUIT_CREDVAULT_TENANT_KEY
pnpm dev                     # Next.js dev server on :3000
```

With a sibling `../credvault` checkout whose stack is up (`docker compose up -d`):

```bash
pnpm test:live       # full suite including live tests; auto-discovers credvault's tenant key
```

The live-test gate resolves `CONDUIT_CREDVAULT_URL`, `CONDUIT_TEST_DATABASE_URL`, and
either `CONDUIT_CREDVAULT_TENANT_KEY` or `CONDUIT_TENANT_KEY_FILE`. See
[`CLAUDE.md`](CLAUDE.md) and `scripts/live-test.sh` for overrides.

## The checks that gate every change

CI expects the same contract as `pnpm verify`. Run it locally before pushing:

```bash
pnpm typecheck
pnpm lint
pnpm test            # Vitest; live suites stay gated off
```

Equivalently, `pnpm verify` runs all three. A change is mergeable when these are green.

## Design principles to preserve

A change that weakens any of these needs a very good reason and explicit discussion:

- **Credentials do not live in conduit.** Fetch a guaranteed-valid token from credvault at
  execution time. Do not add a parallel store, cache of long-lived secrets, or refresh
  path inside this repo.
- **A new integration is a declarative manifest, not a code change.** Each action declares
  its endpoint, input schema, auth method, and output contract. Prefer extending the
  catalog over adding control flow to the engine.
- **The HTTP contract with credvault is the only coupling.** Keep it pinned and versioned;
  don't leak vault internals into the action plane.
- **Tests and the docs are the source of truth.** If you change behavior, update tests and
  the relevant docs (`README.md`, `SPEC.md`, `CONTRACTS.md`, `PLAN.md`) in the same PR.

## Submitting a pull request

1. **Open an issue first** for anything non-trivial, so the approach can be agreed before
   you invest in it. Small, obvious fixes can go straight to a PR.
2. **Branch** from `main`.
3. **Keep the PR focused.** One logical change per PR; unrelated cleanups go in their own.
4. **Add or update tests** for any behavior change. New catalog actions should be covered
   by the offline suite; live tests are optional unless you are changing execution paths.
5. **Update documentation** when behavior, config, or the API surface changes.
6. **Write a clear PR description**: what changed, why, and how you verified it.
7. **Ensure CI is green.** PRs are not reviewed until the gates pass.

## Commit messages

Write imperative, descriptive commit subjects ("Add Slack list-channels action", not
"changes"). Explain the *why* in the body when it isn't obvious.

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License, Version 2.0](LICENSE), consistent with the rest of the project.
