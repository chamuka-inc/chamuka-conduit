# Vision

**conduit** lets AI agents take authenticated actions in third-party apps through one
uniform interface. It is for developers building agents and automations who do not want
to implement, secure, and maintain per-app OAuth, API clients, and credential storage
themselves. An agent points at conduit and gets, for any connected app, a set of typed
**tools** it can discover and **execute on behalf of a specific end-user** — conduit
resolves the right credential (via credvault), calls the provider, and returns a
normalized result or a typed error.

**Definition of done (the single sentence):** an agent can discover an app's available
actions as typed, function-callable tools and execute any of them for a named end-user —
receiving a normalized result or a clear typed error — without the agent's developer ever
handling the user's credentials or writing a single line of app-specific integration code.

This vision is the touchstone. Every requirement, architectural choice, and contract in
the later phases is checked against it. The full capability map (north star) and the slice
chosen for first implementation are recorded in `SPEC.md`; this paragraph is what they must
serve.
