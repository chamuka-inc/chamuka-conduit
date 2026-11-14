# Security Policy

conduit sits on the execution path between agents and third-party APIs and asks credvault
for tokens at call time. We take its security posture seriously and ask that you do too
when reporting issues.

## Supported versions

This project follows semantic versioning. Security fixes are released for the latest
minor version of the current major line.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| older   | :x:                |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately through one of:

1. **GitHub Security Advisories** (preferred) — use the
   ["Report a vulnerability"](https://github.com/chamuka-inc/conduit/security/advisories/new)
   button on the repository's *Security* tab. This keeps the report private and lets us
   collaborate on a fix and a CVE in one place.
2. **Email** — TODO: replace this placeholder with the public security contact Swift
   chooses before a public release. Do not use a personal mailbox.

Please include:

- A description of the issue and the impact you believe it has.
- Steps to reproduce, or a proof-of-concept, if available.
- The affected version, commit, or deployment configuration.
- Any suggested remediation.

## What to expect

- **Acknowledgement** within **3 business days**.
- An initial **assessment and severity rating** within **7 business days**.
- Regular updates at least every **7 days** until resolution.
- **Coordinated disclosure**: we will agree on a disclosure timeline with you, typically
  within **90 days** of the report, and credit you in the advisory unless you prefer to
  remain anonymous.

## Scope

In scope:

- The `@conduit/*` packages and the `apps/web` Next.js app in this repository.
- The invocation engine, identity/API-key handling, and the credvault client boundary.
- Anything that could lead to token leakage, cross-tenant access, unauthorized action
  execution, or request/response data leaking into logs.

Out of scope:

- Vulnerabilities in third-party dependencies (report those upstream; we will pick up the
  fix on update). You are still welcome to flag them so we can bump.
- Issues in credvault itself — report those to the
  [credvault](https://github.com/chamuka-inc/credvault) security process.
- Denial of service from unbounded request volume against an unprotected instance —
  conduit is designed to sit behind your platform's own gateway and network policy.

Thank you for helping keep conduit and its users safe.
