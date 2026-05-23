# Enforce Supabase auth as Studio's access gate

**Date:** 2026-05-23
**Status:** Under review — a blocking prerequisite was found during spec review (see
"Blocking prerequisite" below) and must be resolved before this ships.
**Sub-project:** user-facing auth (sibling of the v4 fork; see
`2026-05-17-openclaw-studio-v4-fork-design.md`)

## Problem

Studio's login page, `@supabase/ssr` clients, OAuth callback, and a session-refresh
proxy already exist, and `server/network-policy.js` now permits a token-free public bind
when `STUDIO_AUTH_MODE=supabase` + the `NEXT_PUBLIC_SUPABASE_*` values are set. The
`agents-platform` deployment already runs this way (`HOST=0.0.0.0`,
`STUDIO_AUTH_MODE=supabase`, no `STUDIO_ACCESS_TOKEN`, public Traefik Ingress with **no**
auth proxy in front).

But **nothing enforces login**:

- `src/lib/supabase/middleware.ts` refreshes the session but its gating redirect is
  commented out, so unauthenticated page requests are served.
- `server/access-gate.js` only guards `/api/*` **when `STUDIO_ACCESS_TOKEN` is set**. In
  supabase mode the token is unset, so that gate is disabled, and the proxy `matcher`
  deliberately excludes `/api`.

Net effect: the public deployment currently serves the full Studio UI **and** API to
anyone, with no login required. This spec closes that hole using Supabase as the sole
gate — replacing the token, with no token-approval step.

## Blocking prerequisite: runtime delivery of Supabase public config

**Status: VERIFIED against the Next.js docs during spec review. Must be fixed before
enforcement ships, or it causes a total lockout.**

`NEXT_PUBLIC_*` env vars are **inlined into the JS bundle at `next build` and frozen**.
Per the Next.js docs: *"After being built, your application will no longer respond to
changes to `NEXT_PUBLIC_` environment variables... If you require access to runtime
environment values on the client, you must set up your own API to provide them."* This
repo's `Dockerfile` runs `npm run build` with **no build args**, while `agents-platform`
injects `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at **deploy**
time via ConfigMap — and with **per-environment** values (`*_HPRD` vs `*_PRD`).

Consequences in the deployed image (all `NEXT_PUBLIC_SUPABASE_*` references are inlined
**empty**):

- **Browser** (`src/lib/supabase/client.ts`): empty URL/key → the browser Supabase client
  cannot reach Supabase → login cannot work.
- **Server** (`src/lib/supabase/{server,middleware}.ts`, `src/app/auth/callback`): the
  same `NEXT_PUBLIC_` references are inlined empty server-side too, so
  `createServerClient(url, key)` throws ("supabaseUrl/supabaseKey is required").

So enabling enforcement on the current image would **lock everyone out** (redirect to a
`/login` that can't authenticate, plus 500s from the throwing server client). Build args
can't fix it: the per-env values (`_HPRD`/`_PRD`) rule out a single image with baked-in
publics.

**Required fix (recommended approach):**

- **Server clients** read **non-public, runtime** env — `SUPABASE_URL` and
  `SUPABASE_PUBLISHABLE_KEY` — not `NEXT_PUBLIC_*`. Non-public vars are never inlined and
  are read at runtime in Node. In Next 16 the proxy (`proxy.ts`, fixed Node.js runtime) and
  App Router route handlers (`server.ts`, callback) all run on Node, so this works in all
  three. This half is a small, low-risk change (an env-var rename + reads).
- **Browser client** gets config at runtime: the root `layout.tsx` (server component,
  using `connection()` to force runtime evaluation) reads runtime env and injects
  `window.__STUDIO_PUBLIC_CONFIG__ = { supabaseUrl, supabaseKey }` via an inline script;
  `client.ts` reads from that, falling back to `NEXT_PUBLIC_*` for local dev. (Alternative:
  a `GET /api/public-config` endpoint read on client init — but it must stay **un-gated**
  by the auth proxy.)
- **`agents-platform`** ConfigMap provides the runtime vars (`SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY`) — these are server-side and non-public, so runtime injection
  works.
- **`server/network-policy.js`** `isSupabaseAuthConfigured` currently checks the
  `NEXT_PUBLIC_SUPABASE_*` names for the public-bind guard; it must be reconciled to the
  chosen runtime var names (accept `SUPABASE_*`, or both) so the bind guard stays
  consistent with what the clients actually read.

With the server half reduced to an env-var rename (above), the remaining real work is the
**browser** runtime-injection. That is small enough to fold in as **Phase 0 of this spec**
rather than a separate sub-project — recommended. **Open decision for the user:** Phase 0
here, or split out. Either way, enforcement must not ship until config delivery is in place
and verified against a running pod (otherwise enforcement = lockout).

## Goal & non-goals

**Goal.** When `STUDIO_AUTH_MODE=supabase`, a valid Supabase session is required to reach
any page or API route. Any authenticated user (email/password or Google) gets full
access. When the mode is not `supabase` (local `npm run dev`), behavior is unchanged — no
login is required.

**Non-goals (explicitly later sub-projects).**

- Authorization beyond authentication — orgs, roles, per-tenant scoping, allowlists. For
  now, **any authenticated Supabase user is allowed**.
- Password reset, sign-up flow, sign-out UI (sign-up was already removed; `/auth/signout`
  exists but is not yet surfaced in the UI).
- Editing `agents-platform` manifests directly in this repo. The image-tag bump and the
  new `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` ConfigMap entries (see Blocking
  prerequisite) are called out as follow-ups for that repo, not done here.

## Design

### Decision helper (isolated, pure)

New file `src/lib/supabase/auth-gate.ts`, dependency-free and unit-testable:

- `studioAuthEnforced(env = process.env): boolean` — returns `true` only when
  `env.STUDIO_AUTH_MODE` (trimmed, lowercased) === `"supabase"`. (Mirrors the
  `isSupabaseAuthConfigured` style in `server/network-policy.js`, but only checks the
  mode. `STUDIO_AUTH_MODE` is **non-public**, so — unlike the `NEXT_PUBLIC_*` values — it
  is read at runtime and never inlined; see Blocking prerequisite.)
- `resolveAuthDecision({ enforce, hasClaims, pathname }): AuthDecision` where
  `AuthDecision = "allow" | "redirect-login" | "deny-api"`. Logic:
  - `!enforce` → `"allow"`
  - `hasClaims` → `"allow"`
  - pathname is `/login` or starts with `/auth/` → `"allow"`
  - pathname starts with `/api/` → `"deny-api"`
  - otherwise → `"redirect-login"`

This is the entire branching logic; the proxy is a thin adapter around it.

### Proxy wiring

In `src/lib/supabase/middleware.ts` `updateSession`, after the existing
`getClaims()` call (keep the "do not run code between createServerClient and getClaims"
ordering):

```
const decision = resolveAuthDecision({
  enforce: studioAuthEnforced(),
  hasClaims: Boolean(claims),
  pathname: request.nextUrl.pathname,
});

if (decision === "deny-api") {
  return NextResponse.json({ error: "auth_required" }, { status: 401 });
}
if (decision === "redirect-login") {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}
// decision === "allow"
return supabaseResponse;
```

The previously commented-out gating block is removed (superseded by this). The
cache-control header forwarding added earlier stays.

### Matcher

`src/proxy.ts` `config.matcher` drops `api` from the negative lookahead so `/api/*` runs
the proxy, while still excluding Next internals and static image assets (so the `/login`
page's `_next/static` CSS/JS load while unauthenticated):

```
"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
```

### Data flow (supabase mode, unauthenticated)

(Assumes the Blocking-prerequisite is in place, so the server/browser Supabase clients are
configured at runtime and `getClaims()` works.)

1. Browser hits `https://openclaw.airexpert.cloud/` → custom Node server →
   `access-gate.js` disabled (no token) → passes to Next.
2. Proxy runs, `getClaims()` returns no claims → `resolveAuthDecision` → `"redirect-login"`
   → 302 to `/login`.
3. `/login` and its `_next/static` assets are allowed → page renders.
4. User logs in (password or Google → `/auth/callback` exchanges the code, sets cookies).
5. Subsequent requests carry the session cookie → `getClaims()` returns claims →
   `"allow"` for pages and `/api/*`.
6. A browser `fetch`/EventSource to `/api/*` without a session gets `401 auth_required`.

### Interactions & edge cases

- **Local dev:** `STUDIO_AUTH_MODE` unset → `enforce=false` → proxy stays refresh-only →
  no login. Loopback binds need no auth per `network-policy.js`.
- **Token mode vs supabase mode:** mutually exclusive in practice. If a token were also
  set, `access-gate.js` would gate `/api` at the server layer *and* the proxy would
  enforce session — both must pass. Not a supported combination; no special handling.
- **SSE `/api/runtime/stream`:** matched as `/api/*`; unauthenticated → 401 (EventSource
  errors, which is correct); authenticated → cookie present → allowed.
- **Proxy runtime / env (verified):** In Next 16, `proxy.ts` runs on the **Node.js
  runtime** — fixed and not configurable (a change from the old edge-runtime
  `middleware.ts`, where only `NEXT_PUBLIC_*` were available). So the proxy has full
  runtime `process.env` access: `STUDIO_AUTH_MODE` (non-public) is read at runtime, never
  inlined. Only `NEXT_PUBLIC_*` *references* are still build-inlined (the reason for the
  Blocking prerequisite's browser fix). (`server/network-policy.js` likewise reads env at
  runtime — it is plain Node, not bundled by Next.)

## Testing

New `tests/unit/supabaseAuthGate.test.ts` (Vitest, existing `tests/unit/**` setup):

- `studioAuthEnforced`: `"supabase"` (any case/whitespace) → true; unset/`""`/other → false.
- `resolveAuthDecision`:
  - `enforce:false` + no claims + any path → `"allow"`
  - `enforce:true` + claims + `/api/runtime/fleet` → `"allow"`
  - `enforce:true` + no claims + `/login` → `"allow"`
  - `enforce:true` + no claims + `/auth/callback` → `"allow"`
  - `enforce:true` + no claims + `/api/runtime/fleet` → `"deny-api"`
  - `enforce:true` + no claims + `/` (and `/agents/x`) → `"redirect-login"`

`npm run typecheck` and `npm run lint` must pass. A manual dev check
(`STUDIO_AUTH_MODE=supabase npm run dev`, confirm `/` redirects to `/login` and `/api/...`
returns 401) is a nice-to-have but the pure-helper tests are the contract.

## Rollout

0. **Prerequisite (must land first):** runtime Supabase public-config delivery (see
   "Blocking prerequisite"). Server clients read `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`
   at runtime; the browser client gets config via runtime injection. Verify against a
   running pod that login works **before** enabling enforcement — otherwise step 3 is a
   lockout.
1. Implement enforcement + tests, commit, push to `main`.
2. `npm run release` (from Bash, not PowerShell) → tags `01.01`, triggers the
   `systemease/openclaw-studio:01.01` image build.
3. **Follow-up in `agents-platform`** (separate repo, not done here): add the runtime
   `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` ConfigMap entries and bump the `studio`
   kustomization image pin `01.00 → 01.01`, then redeploy. Until then, `01.00` stays
   unauthenticated — so the pin bump (with config in place) is the step that actually
   closes the hole in prod.

## Files touched (openclaw-studio)

Enforcement scope (this spec):

- `src/lib/supabase/auth-gate.ts` — new pure helper.
- `src/lib/supabase/middleware.ts` — replace commented gating with helper-driven enforcement.
- `src/proxy.ts` — widen matcher to include `/api`.
- `tests/unit/supabaseAuthGate.test.ts` — new tests.
- `CLAUDE.md` — short note that supabase mode enforces login on pages + API.

Out of scope here — owned by the Blocking-prerequisite (config-delivery) work:
`src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/app/auth/callback`, and
`src/app/layout.tsx` (runtime config reads/injection). The proxy's own `createServerClient`
call will also switch to the runtime config source as part of that work; this spec assumes
that is done.
