# Enforce Supabase auth as Studio's access gate

**Date:** 2026-05-23
**Status:** Approved (design)
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
- Changing the `agents-platform` deployment manifests beyond the image-tag bump
  (called out as a follow-up, not done in this repo).

## Design

### Decision helper (isolated, pure)

New file `src/lib/supabase/auth-gate.ts`, dependency-free and unit-testable:

- `studioAuthEnforced(env = process.env): boolean` — returns `true` only when
  `env.STUDIO_AUTH_MODE` (trimmed, lowercased) === `"supabase"`. (Mirrors the
  `isSupabaseAuthConfigured` style already in `server/network-policy.js`, but only checks
  the mode — the proxy already has the URL/key via `NEXT_PUBLIC_*`.)
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
- **Edge runtime / env:** the proxy reads `process.env.STUDIO_AUTH_MODE` at runtime; this
  app is self-hosted via a custom Node server, and the proxy already reads
  `NEXT_PUBLIC_SUPABASE_URL`/`_PUBLISHABLE_KEY` from `process.env` the same way.

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

1. Implement + tests, commit, push to `main`.
2. `npm run release` (from Bash, not PowerShell) → tags `01.01`, triggers the
   `systemease/openclaw-studio:01.01` image build.
3. **Follow-up in `agents-platform`** (separate repo, not done here): bump the `studio`
   kustomization image pin `01.00 → 01.01` and redeploy. Until then, `01.00` stays
   unauthenticated — so the pin bump is the step that actually closes the hole in prod.

## Files touched (openclaw-studio)

- `src/lib/supabase/auth-gate.ts` — new pure helper.
- `src/lib/supabase/middleware.ts` — replace commented gating with helper-driven enforcement.
- `src/proxy.ts` — widen matcher to include `/api`.
- `tests/unit/supabaseAuthGate.test.ts` — new tests.
- `CLAUDE.md` — short note that supabase mode enforces login on pages + API.
