# Agent Instructions

This repository is part of the **HarithKavish ecosystem**.

**Before changing anything**, read
[AGENT_BOOTSTRAP.md](https://github.com/HarithKavish/harithkavish-governance/blob/main/AGENT_BOOTSTRAP.md)
and follow it. See [GOVERNANCE.md](GOVERNANCE.md) for what governs this repository.

Do not begin implementation work before discovery is complete.

## Hard stops

A reminder, not the rule. These restate doctrine articles so an agent that reads nothing
else still has the guardrails. Governance is authoritative; if these ever disagree with
it, governance wins.

- Do not commit to the production branch (Article 6).
- Do not commit secrets or credentials (Article 5, SECURITY).
- Do not redefine design foundations locally (Article 4).
- Do not copy governance or the design system into this repository (Article 3).
- Do not act outside the scope you were given (Article 9).

## About this repository

Admin is the owner-only operator console for the HarithKavish ecosystem, deployed as
a static GitHub Pages site at admin.harithkavish.com. It holds no session or secret of
its own — every screen is answered by `auth.harithkavish.com`, gated to a single
owner account. See README.md for the access-control design and server-side routes.

## Working here

No build step, no dependencies. `assets/admin.css`/`assets/admin.js` add only what
the shared design system does not provide — see README.md's Design section before
adding local styles or components. No other repository-specific rules beyond global
governance.
