# Supabase Auth Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a valid Supabase session required for all pages and `/api/*` routes when `STUDIO_AUTH_MODE=supabase` (any authenticated user), without a `STUDIO_ACCESS_TOKEN` — and first make the Supabase public config actually reach the browser/server at runtime so enabling enforcement doesn't lock everyone out.

**Architecture:** Two phases. **Phase 0 (prerequisite)** delivers Supabase public config at runtime: server code (proxy `proxy.ts` + route handlers, all Node.js runtime in Next 16) reads non-public `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`; the browser gets config via a `window.__STUDIO_PUBLIC_CONFIG__` script injected by the root layout (because `NEXT_PUBLIC_*` are frozen at build time). **Phase 1 (enforcement)** adds a pure decision helper (`auth-gate.ts`) driven from the proxy: redirect pages to `/login`, `401` API requests, when unauthenticated in supabase mode; widen the proxy matcher to cover `/api`.

**Tech Stack:** Next.js 16 (App Router, custom Node server), React 19, `@supabase/ssr`, Vitest (`tests/unit/**`, jsdom; node env via `// @vitest-environment node`).

**Spec:** `docs/superpowers/specs/2026-05-23-supabase-auth-enforcement-design.md`

**Why two phases:** `NEXT_PUBLIC_*` env vars are inlined at `next build` and frozen; the Docker image is built with no build args and `agents-platform` injects per-environment Supabase values at deploy time, so the deployed browser client is currently empty. Enforcing auth on that = lockout. Phase 0 fixes config delivery; Phase 1 enforces.

---

## File Structure

New files:
- `src/lib/supabase/config.ts` — `resolveServerSupabaseConfig(env)`: server-side runtime config resolver (non-public `SUPABASE_*` with `NEXT_PUBLIC_*` fallback). Pure (takes env).
- `src/lib/supabase/auth-gate.ts` — `studioAuthEnforced(env)` + `resolveAuthDecision(...)`. Pure decision logic.
- `tests/unit/supabaseConfig.test.ts` — tests for the config resolver.
- `tests/unit/supabaseAuthGate.test.ts` — tests for the auth-gate helpers.

Modified files:
- `src/lib/supabase/server.ts` — use the config resolver.
- `src/lib/supabase/middleware.ts` — use the config resolver; add helper-driven enforcement.
- `src/lib/supabase/client.ts` — read injected `window.__STUDIO_PUBLIC_CONFIG__` (fallback to `NEXT_PUBLIC_*`).
- `src/app/layout.tsx` — inject `window.__STUDIO_PUBLIC_CONFIG__` from runtime env (`connection()`).
- `src/proxy.ts` — widen `config.matcher` to include `/api`.
- `server/network-policy.js` — `isSupabaseAuthConfigured` accepts `SUPABASE_*` or `NEXT_PUBLIC_*`.
- `.env.example` — document `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`.
- `CLAUDE.md` — note supabase mode enforces login on pages + API.

---

# PHASE 0 — Runtime Supabase public config

### Task 0.1: Server-side config resolver (TDD)

**Files:**
- Create: `src/lib/supabase/config.ts`
- Test: `tests/unit/supabaseConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/supabaseConfig.test.ts
// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveServerSupabaseConfig } from "@/lib/supabase/config";

describe("resolveServerSupabaseConfig", () => {
  it("prefers non-public SUPABASE_* vars", () => {
    const cfg = resolveServerSupabaseConfig({
      SUPABASE_URL: "https://runtime.example",
      SUPABASE_PUBLISHABLE_KEY: "sb_runtime",
      NEXT_PUBLIC_SUPABASE_URL: "https://build.example",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_build",
    });
    expect(cfg).toEqual({
      url: "https://runtime.example",
      publishableKey: "sb_runtime",
    });
  });

  it("falls back to NEXT_PUBLIC_* when non-public unset", () => {
    const cfg = resolveServerSupabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://build.example",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_build",
    });
    expect(cfg).toEqual({
      url: "https://build.example",
      publishableKey: "sb_build",
    });
  });

  it("returns empty strings (trimmed) when nothing set", () => {
    expect(resolveServerSupabaseConfig({})).toEqual({
      url: "",
      publishableKey: "",
    });
    expect(
      resolveServerSupabaseConfig({ SUPABASE_URL: "  https://x  " }).url
    ).toBe("https://x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabaseConfig.test.ts`
Expected: FAIL — cannot find module `@/lib/supabase/config`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/supabase/config.ts

export type SupabaseRuntimeConfig = {
  url: string;
  publishableKey: string;
};

type EnvLike = Record<string, string | undefined>;

/**
 * Resolves the Supabase public config for SERVER-side use at runtime.
 *
 * Reads non-public `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` first (these are
 * never build-inlined and are available at runtime in Node — including the Next
 * 16 `proxy.ts` and App Router route handlers, which run on the Node.js
 * runtime). Falls back to the `NEXT_PUBLIC_*` names so local `npm run dev`
 * (which only sets the public names in `.env.local`) keeps working.
 *
 * `env` is a parameter so the function is pure and unit-testable; it is read
 * dynamically (not `process.env.NEXT_PUBLIC_*` literals), which also prevents
 * build-time inlining.
 */
export function resolveServerSupabaseConfig(
  env: EnvLike = process.env
): SupabaseRuntimeConfig {
  const url = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const publishableKey = (
    env.SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    ""
  ).trim();
  return { url, publishableKey };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabaseConfig.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/config.ts tests/unit/supabaseConfig.test.ts
git commit -m "feat: add server-side Supabase runtime config resolver"
```

---

### Task 0.2: Use the resolver in the server clients

**Files:**
- Modify: `src/lib/supabase/server.ts`
- Modify: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Update `server.ts` to use the resolver**

Replace the two `process.env.NEXT_PUBLIC_*!` arguments. The full file becomes:

```ts
// src/lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { resolveServerSupabaseConfig } from "@/lib/supabase/config";

/**
 * Server-side Supabase client for Server Components, Route Handlers, and
 * Server Actions. `cookies()` is async in Next 15+, so this factory is async.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = resolveServerSupabaseConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // `setAll` called from a Server Component; safe to ignore when the
          // proxy is refreshing the session.
        }
      },
    },
  });
}
```

- [ ] **Step 2: Update `middleware.ts` to use the resolver**

In `src/lib/supabase/middleware.ts`, add the import at the top:

```ts
import { resolveServerSupabaseConfig } from "@/lib/supabase/config";
```

Then replace the `createServerClient(...)` URL/key arguments. Change:

```ts
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
```

to:

```ts
  const { url, publishableKey } = resolveServerSupabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
```

(Leave the `cookies: { getAll, setAll }` object and everything after it unchanged. The closing `)` of `createServerClient` stays.)

- [ ] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint src/lib/supabase/server.ts src/lib/supabase/middleware.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/server.ts src/lib/supabase/middleware.ts
git commit -m "refactor: read Supabase config via runtime resolver in server clients"
```

---

### Task 0.3: Browser client reads injected runtime config

**Files:**
- Modify: `src/lib/supabase/client.ts`

- [ ] **Step 1: Replace the browser client to read injected config**

Full file becomes:

```ts
// src/lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

type InjectedPublicConfig = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
};

/**
 * Reads the Supabase public config in the browser. In production the
 * `NEXT_PUBLIC_*` values are frozen empty at build time (the image is built
 * with no build args), so the real values arrive at runtime via
 * `window.__STUDIO_PUBLIC_CONFIG__`, injected by the root layout. The
 * `NEXT_PUBLIC_*` fallback keeps local `npm run dev` working.
 */
function readBrowserSupabaseConfig(): { url: string; key: string } {
  const injected =
    (typeof window !== "undefined"
      ? (window as unknown as { __STUDIO_PUBLIC_CONFIG__?: InjectedPublicConfig })
          .__STUDIO_PUBLIC_CONFIG__
      : undefined) ?? {};

  const url = (
    injected.supabaseUrl ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ""
  ).trim();
  const key = (
    injected.supabasePublishableKey ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    ""
  ).trim();
  return { url, key };
}

/**
 * Browser-side Supabase client. Safe to use in Client Components — it only
 * carries the publishable key, which is designed to be exposed to the browser.
 */
export function createClient() {
  const { url, key } = readBrowserSupabaseConfig();
  return createBrowserClient(url, key);
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint src/lib/supabase/client.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/client.ts
git commit -m "feat: browser Supabase client reads runtime-injected public config"
```

---

### Task 0.4: Inject runtime config from the root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Make the layout async and inject the config script**

Add imports at the top of `src/app/layout.tsx`:

```ts
import { connection } from "next/server";

import { resolveServerSupabaseConfig } from "@/lib/supabase/config";
```

Change the component signature from sync to async and compute the injected config. Replace:

```tsx
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t?t==='dark':m;document.documentElement.classList.toggle('dark',d);}catch(e){}})();",
          }}
        />
      </head>
```

with:

```tsx
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Force runtime evaluation of process.env (avoids build-time freezing) so the
  // browser receives per-environment Supabase config from the running container.
  await connection();
  const { url, publishableKey } = resolveServerSupabaseConfig();
  const publicConfigJson = JSON.stringify({
    supabaseUrl: url,
    supabasePublishableKey: publishableKey,
  }).replace(/</g, "\\u003c");

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__STUDIO_PUBLIC_CONFIG__=${publicConfigJson};`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t?t==='dark':m;document.documentElement.classList.toggle('dark',d);}catch(e){}})();",
          }}
        />
      </head>
```

(Everything else in the file — `metadata`, fonts, `<body>` — stays unchanged.)

- [ ] **Step 2: Verify typecheck + lint + build**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint src/app/layout.tsx`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds. `connection()` in the root layout opts routes into
dynamic rendering — expected and fine for Studio (already fully dynamic).
**If the build fails** because of `connection()` in the root layout, fall back to
adding `export const dynamic = "force-dynamic";` to `src/app/layout.tsx` and
remove the `await connection()` call (same effect: per-request render so the
injected env values are runtime, not build-time). Re-run `npm run build`.

- [ ] **Step 3: Manual dev check**

Run: `npm run dev` (loopback; no auth mode needed).
Open `http://localhost:3000/login`, view page source, confirm a
`window.__STUDIO_PUBLIC_CONFIG__={"supabaseUrl":"https://hbavgdajvpisqhyuupex.supabase.co",...}` script is present (values come from `.env.local`).
Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: inject Supabase public config into the browser at runtime"
```

---

### Task 0.5: Reconcile the public-bind guard (TDD)

**Files:**
- Modify: `server/network-policy.js`
- Test: `tests/unit/serverNetworkPolicy.test.ts` (append cases)

- [ ] **Step 1: Add failing tests for the `SUPABASE_*` path**

Append inside the existing top-level `describe` in `tests/unit/serverNetworkPolicy.test.ts` (import style already established in that file — match it). Add:

```ts
  it("treats non-public SUPABASE_* as configured supabase auth", async () => {
    const { isSupabaseAuthConfigured } = await import(
      "../../server/network-policy"
    );
    expect(
      isSupabaseAuthConfigured({
        STUDIO_AUTH_MODE: "supabase",
        SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      })
    ).toBe(true);
  });

  it("is not configured when supabase mode but no url/key", async () => {
    const { isSupabaseAuthConfigured } = await import(
      "../../server/network-policy"
    );
    expect(isSupabaseAuthConfigured({ STUDIO_AUTH_MODE: "supabase" })).toBe(
      false
    );
  });
```

- [ ] **Step 2: Run tests to verify the new SUPABASE_* case fails**

Run: `npx vitest run tests/unit/serverNetworkPolicy.test.ts`
Expected: the "non-public SUPABASE_*" case FAILS (current code only checks `NEXT_PUBLIC_*`).

- [ ] **Step 3: Update `isSupabaseAuthConfigured`**

In `server/network-policy.js`, replace:

```js
const isSupabaseAuthConfigured = (env = process.env) => {
  const mode = String(env.STUDIO_AUTH_MODE ?? "").trim().toLowerCase();
  if (mode !== "supabase") return false;

  return Boolean(
    String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim() &&
      String(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim()
  );
};
```

with:

```js
const isSupabaseAuthConfigured = (env = process.env) => {
  const mode = String(env.STUDIO_AUTH_MODE ?? "").trim().toLowerCase();
  if (mode !== "supabase") return false;

  const url = String(
    env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  ).trim();
  const key = String(
    env.SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""
  ).trim();
  return Boolean(url && key);
};
```

- [ ] **Step 4: Run the full network-policy test file**

Run: `npx vitest run tests/unit/serverNetworkPolicy.test.ts`
Expected: PASS (existing `NEXT_PUBLIC_*` cases still pass via fallback; new cases pass).

- [ ] **Step 5: Commit**

```bash
git add server/network-policy.js tests/unit/serverNetworkPolicy.test.ts
git commit -m "feat: accept non-public SUPABASE_* in the public-bind guard"
```

---

### Task 0.6: Document the runtime env vars

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add server-side runtime vars to `.env.example`**

Under the existing `# --- Supabase auth (user-facing login) ---` block, add (keep the existing `STUDIO_AUTH_MODE` and `NEXT_PUBLIC_*` lines):

```
# Server-side (non-public) Supabase config, read at RUNTIME by proxy.ts, route
# handlers, and the root layout. Required in the deployed image because
# NEXT_PUBLIC_* are frozen at build time. For local dev the NEXT_PUBLIC_* values
# above are sufficient (the server resolver falls back to them).
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY runtime vars"
```

---

# PHASE 1 — Enforcement

### Task 1.1: Auth-gate decision helper (TDD)

**Files:**
- Create: `src/lib/supabase/auth-gate.ts`
- Test: `tests/unit/supabaseAuthGate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/supabaseAuthGate.test.ts
// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  resolveAuthDecision,
  studioAuthEnforced,
} from "@/lib/supabase/auth-gate";

describe("studioAuthEnforced", () => {
  it("is true only for STUDIO_AUTH_MODE=supabase (case/space-insensitive)", () => {
    expect(studioAuthEnforced({ STUDIO_AUTH_MODE: "supabase" })).toBe(true);
    expect(studioAuthEnforced({ STUDIO_AUTH_MODE: "  SUPABASE " })).toBe(true);
  });

  it("is false when unset or another mode", () => {
    expect(studioAuthEnforced({})).toBe(false);
    expect(studioAuthEnforced({ STUDIO_AUTH_MODE: "" })).toBe(false);
    expect(studioAuthEnforced({ STUDIO_AUTH_MODE: "token" })).toBe(false);
  });
});

describe("resolveAuthDecision", () => {
  it("allows everything when not enforcing", () => {
    expect(
      resolveAuthDecision({ enforce: false, hasClaims: false, pathname: "/" })
    ).toBe("allow");
    expect(
      resolveAuthDecision({
        enforce: false,
        hasClaims: false,
        pathname: "/api/runtime/fleet",
      })
    ).toBe("allow");
  });

  it("allows authenticated requests", () => {
    expect(
      resolveAuthDecision({
        enforce: true,
        hasClaims: true,
        pathname: "/api/runtime/fleet",
      })
    ).toBe("allow");
  });

  it("allows the login and auth routes when unauthenticated", () => {
    expect(
      resolveAuthDecision({ enforce: true, hasClaims: false, pathname: "/login" })
    ).toBe("allow");
    expect(
      resolveAuthDecision({
        enforce: true,
        hasClaims: false,
        pathname: "/auth/callback",
      })
    ).toBe("allow");
  });

  it("401s unauthenticated API requests", () => {
    expect(
      resolveAuthDecision({
        enforce: true,
        hasClaims: false,
        pathname: "/api/runtime/fleet",
      })
    ).toBe("deny-api");
  });

  it("redirects unauthenticated page requests to login", () => {
    expect(
      resolveAuthDecision({ enforce: true, hasClaims: false, pathname: "/" })
    ).toBe("redirect-login");
    expect(
      resolveAuthDecision({
        enforce: true,
        hasClaims: false,
        pathname: "/agents/abc",
      })
    ).toBe("redirect-login");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/supabaseAuthGate.test.ts`
Expected: FAIL — cannot find module `@/lib/supabase/auth-gate`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/supabase/auth-gate.ts

export type AuthDecision = "allow" | "redirect-login" | "deny-api";

type EnvLike = Record<string, string | undefined>;

/** True only when Studio is configured to enforce Supabase browser auth. */
export function studioAuthEnforced(env: EnvLike = process.env): boolean {
  return String(env.STUDIO_AUTH_MODE ?? "").trim().toLowerCase() === "supabase";
}

/**
 * Pure access decision for the proxy. Public routes (`/login`, `/auth/*`) are
 * always allowed so login can happen; unauthenticated API requests get a 401,
 * unauthenticated page requests are redirected to `/login`.
 */
export function resolveAuthDecision(args: {
  enforce: boolean;
  hasClaims: boolean;
  pathname: string;
}): AuthDecision {
  const { enforce, hasClaims, pathname } = args;
  if (!enforce) return "allow";
  if (hasClaims) return "allow";
  if (pathname === "/login" || pathname.startsWith("/auth/")) return "allow";
  if (pathname.startsWith("/api/")) return "deny-api";
  return "redirect-login";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/supabaseAuthGate.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/auth-gate.ts tests/unit/supabaseAuthGate.test.ts
git commit -m "feat: add pure Supabase auth-gate decision helper"
```

---

### Task 1.2: Wire enforcement into the proxy

**Files:**
- Modify: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Import the helpers**

At the top of `src/lib/supabase/middleware.ts`, add:

```ts
import {
  resolveAuthDecision,
  studioAuthEnforced,
} from "@/lib/supabase/auth-gate";
```

- [ ] **Step 2: Replace the commented gating block with enforcement**

Find the block that currently reads:

```ts
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // --- Opt-in gating: redirect unauthenticated users to /login. ---
  // Uncomment to require login for everything except the login/auth routes.
  //
  // if (
  //   !claims &&
  //   !request.nextUrl.pathname.startsWith("/login") &&
  //   !request.nextUrl.pathname.startsWith("/auth")
  // ) {
  //   const url = request.nextUrl.clone();
  //   url.pathname = "/login";
  //   return NextResponse.redirect(url);
  // }
  void claims;
```

Replace it entirely with:

```ts
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

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
```

(Leave the trailing `return supabaseResponse;` and its comment in place — that is the `"allow"` path.)

- [ ] **Step 3: Update the docstring**

Change the top-of-function docstring note that says it "only *refreshes* the session — it does not force unauthenticated visitors to /login" to reflect the new behavior. Replace that NOTE paragraph with:

```ts
 * When STUDIO_AUTH_MODE=supabase, unauthenticated requests are gated:
 * pages redirect to /login and /api/* return 401. Otherwise it only refreshes
 * the session (local dev needs no login). See lib/supabase/auth-gate.ts.
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint src/lib/supabase/middleware.ts`
Expected: no errors (no unused `void claims;` left behind).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/middleware.ts
git commit -m "feat: enforce Supabase session in the proxy when in supabase mode"
```

---

### Task 1.3: Widen the proxy matcher to cover `/api`

**Files:**
- Modify: `src/proxy.ts`

- [ ] **Step 1: Update the matcher**

In `src/proxy.ts`, change the matcher string. Replace:

```ts
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
```

with:

```ts
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
```

Also update the comment block above the matcher: remove the line that says the API surface is excluded, and note instead that `/api` is now matched so the proxy can gate it (the auth-gate allows `/login` and `/auth/*` in its body).

- [ ] **Step 2: Verify typecheck + lint**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint src/proxy.ts`
Expected: no errors.

- [ ] **Step 3: Manual dev check (enforcement on)**

Run (Bash, so env var is set for the process):
`STUDIO_AUTH_MODE=supabase npm run dev`
Then in another terminal:
- `curl -i http://localhost:3000/` → expect `HTTP/1.1 307` (or 302) with `location: /login`.
- `curl -i http://localhost:3000/api/runtime/fleet` → expect `HTTP/1.1 401` and body `{"error":"auth_required"}`.
- `curl -i http://localhost:3000/login` → expect `HTTP/1.1 200`.
Stop the dev server. (If `STUDIO_AUTH_MODE` is hard to set inline on Windows, run via the Bash tool / git-bash: `STUDIO_AUTH_MODE=supabase npm run dev`.)

- [ ] **Step 4: Commit**

```bash
git add src/proxy.ts
git commit -m "feat: run the proxy on /api so supabase auth gates the API"
```

---

### Task 1.4: Document enforcement in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a note**

In `CLAUDE.md`, in the bullet describing `server/network-policy.js` / the public bind (the "Build & run" section bullet that mentions `STUDIO_AUTH_MODE=supabase`), append a sentence:

```
When `STUDIO_AUTH_MODE=supabase`, `src/proxy.ts` enforces a valid Supabase
session for all pages (redirect to `/login`) and `/api/*` (401) — any
authenticated user is allowed. Supabase public config reaches the browser at
runtime via `window.__STUDIO_PUBLIC_CONFIG__` (injected by `src/app/layout.tsx`),
and server code reads non-public `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` because
`NEXT_PUBLIC_*` are frozen at build time.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note supabase-mode auth enforcement and runtime config"
```

---

# PHASE 2 — Verify & release

### Task 2.1: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck, lint, full test suite**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm run lint`
Expected: no errors.
Run: `npm test -- --run` (or `npx vitest run`)
Expected: all unit tests pass, including the new `supabaseConfig`, `supabaseAuthGate`, and updated `serverNetworkPolicy` tests.

- [ ] **Step 2: Production build smoke**

Run: `npm run build`
Expected: build succeeds; route list still shows `/login`, `/auth/callback`, `/auth/signout`, and `ƒ Proxy`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

### Task 2.2: Release & deployment (requires user go-ahead — outward-facing)

These steps publish a public tag/image and change prod; do them only with explicit approval.

- [ ] **Step 1: Cut the release** (from Bash/git-bash, NOT PowerShell — the script shells out to `git`):

```bash
npm run release
```
Expected: builds, bumps `package.json` to `01.01`, tags `01.01`, pushes → triggers the `systemease/openclaw-studio:01.01` image build.

- [ ] **Step 2: Follow-up in `agents-platform`** (separate repo — not done here):
  - Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the `openclaw-studio-config` ConfigMap (per-environment values, server-side/non-public — alongside or replacing the `NEXT_PUBLIC_*` ones).
  - Bump the `studio` kustomization image pin `01.00 → 01.01`.
  - Redeploy, then verify against a running pod: `/` redirects to `/login`, login (password + Google) works, and an authenticated session reaches the app and `/api/*`.

---

## Notes for the implementer

- **Run order matters:** Phase 0 must be fully done before Phase 1 ships to prod, or enforcement locks users out. In a single dev session it's fine to implement both before deploying.
- **Why a config resolver instead of `NEXT_PUBLIC_*` directly:** `NEXT_PUBLIC_*` are inlined at `next build` and frozen; the image is built without these values and `agents-platform` injects per-env values at deploy time. Server code must read non-public runtime vars; the browser must receive them via the injected `window.__STUDIO_PUBLIC_CONFIG__`.
- **`getClaims()` returns `{ data, error }`** where `data` may be `null`; treat `Boolean(data?.claims)` as "authenticated". Do not run code between `createServerClient` and `getClaims()`.
- **Local dev** sets only `NEXT_PUBLIC_*` (in `.env.local`); the resolver's fallback keeps both the server and the injected browser config working without `STUDIO_AUTH_MODE`, so dev requires no login.
