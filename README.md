# Admin

The operator console for the HarithKavish ecosystem —
[admin.harithkavish.com](https://admin.harithkavish.com).

One account can open it. Everyone else, signed in or not, is told so.

---

## What it shows

**Account holders.** Every account in the identity service: name, chosen
identifier, address and whether it has been proved, the ways that person can
sign in, lifecycle status, live sessions, and unspent recovery codes. Filterable
and sortable. Eight totals sit above it — including how many accounts hold no
recovery code, which is the number worth watching, because a federated-only
account with none has no way back in.

**Surfaces.** The ecosystem as `harithkavish.com/site-data.js` declares it, so a
subdomain added there appears here with no edit to this repository. The state
shown is the one that file publishes. This page does not probe the surfaces: a
browser cannot read a cross-origin response, so anything it claimed about their
health would be a guess dressed up as a measurement.

## How access works

A single static page on GitHub Pages. It holds no session, no secret and no data
of its own — and it *could* hold no session even if it wanted to, because the
ecosystem's session cookie is `__Host-` prefixed and the identity service's adopt
allow-list exists to keep the Pages sites off it.

So every screen is an answer from `auth.harithkavish.com`:

```
admin.harithkavish.com                    auth.harithkavish.com
  │
  │  GET /api/admin/session              (credentials: include)
  ├───────────────────────────────────────────►
  │                                       reads __Host-hk_session
  │                                       reads the account behind it
  │                                       is its address on the owner list,
  │                                       and did a provider prove it?
  │  ◄───────────────────────────────────────── 200 owner
  │  ◄───────────────────────────────────────── 403 signed in, not the owner
  │  ◄───────────────────────────────────────── 401 no session
  │
  │  GET /api/admin/accounts             (same check, again)
  ├───────────────────────────────────────────►
```

Three answers, three screens. The gate is on the route that returns the data as
well as the one that reports the verdict, so skipping the first call gains a
client nothing.

**Auto sign-in.** A `401` sends the visitor to the front door with `next` set to
this page. Someone already signed in anywhere in the ecosystem is waved straight
back with a session and never sees a form — the same experience as every other
surface. The trip is taken **once** per tab, recorded in `sessionStorage`; if the
return still finds no session, the page says so instead of bouncing forever. That
is the same reasoning as the identity service's own `hk_sso_attempt` cookie.

**What is deliberately not the gate.** The `hk.user` cookie is scoped to
`.harithkavish.com`, so every subdomain can write it — including the Pages sites
and `sites.harithkavish.com`, which publishes other people's pages. It is display
state. A console that authorised from it would be a console anyone with a
subdomain could open, so nothing here reads it.

The owner list is a constant in the identity service's code
(`lib/admin/owner.ts`), not an environment variable and not a table. Adding a
reader is a deploy, for the same reason its OAuth client list is in code. The
address must also be **proved** — an unproved address is text somebody typed at
sign-up, so matching on one would let anyone in by typing the owner's address
into a new account.

## Design

The shared design system, loaded from `harithkavish.com/design-system/v1.0.0/`
like every other static surface. `assets/admin.css` adds only what the system
does not have — a data table and the gate screens — and contains no colour of its
own; every value is a token, so both themes follow without this page knowing what
a theme is.

The one place it departs from the system is the container width. `--container` is
1160px, sized for prose at a comfortable measure; eight columns of account data
do not fit that and should not be squeezed into it, so `body[data-page='admin']`
widens it to 1400px. Timeline made the same call for the same reason.

Rows are built from elements and `textContent`, never from a string of HTML.
Names and addresses on this page are typed by other people, and there is no
escaping function to remember if there is no markup to escape from.

## Layout

```
index.html          The page: shell, four gate screens, the console
assets/admin.css    The data table and the gate screens. Tokens only.
assets/admin.js     The gate, the table, the surfaces grid.
favicon.svg         The console's own mark, in the ecosystem accent.
CNAME               admin.harithkavish.com
```

No build step and no dependencies. Deployed to GitHub Pages by
`.github/workflows/deploy.yml` on every push to `main`.

## Working on it locally

The API lives on another origin and is CORS-locked to
`https://admin.harithkavish.com`, so a file served from `localhost` cannot reach
it. `lib/admin/cors.ts` in the identity service admits `http://localhost:4173`
when that service is **not** running in production, so the way to work on this
page against real data is to run the identity service locally and serve this
directory on port 4173.

## Not listed on Nexus

Nexus builds its tiles from the main site's ecosystem list. This console is not
in it, and should not be: it is owner-only and `noindex`, and a launcher tile
advertising it to everyone would be the one thing on the page that told the truth
to the wrong audience.

## Server side

The routes this page calls live in
[HarithKavish/account](https://github.com/HarithKavish/account):

| Path | What it does |
| --- | --- |
| `lib/admin/owner.ts` | The owner list and the three-way verdict |
| `lib/admin/cors.ts` | The origin allow-list, preflight, and `no-store` JSON |
| `lib/admin/accounts.ts` | The read. Never selects a hash, a token or a key |
| `app/api/admin/session/route.ts` | 200 / 403 / 401 |
| `app/api/admin/accounts/route.ts` | The account table |

Both routes are `GET` only. Nothing under `/api/admin` writes, which is why a
same-site request arriving without a CSRF token is harmless — there is no state
for it to change. Adding a write to that API means adding a token check with it.
