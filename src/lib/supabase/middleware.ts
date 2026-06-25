import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { resolveServerSupabaseConfig } from "@/lib/supabase/config";
import {
  hasValidStudioInternalApiToken,
  resolveAuthDecision,
  studioAuthEnforced,
} from "@/lib/supabase/auth-gate";
import { resolveServerStudioBasePath, withStudioBasePath } from "@/lib/studio/base-path";

/**
 * Refreshes the Supabase auth session on every matched request and rewrites the
 * auth cookies onto the response. This keeps server-rendered pages and Route
 * Handlers seeing a valid, non-expired session.
 *
 * When STUDIO_AUTH_MODE=supabase, unauthenticated requests are gated:
 * pages redirect to /login and /api/* return 401. Otherwise it only refreshes
 * the session (local dev needs no login). See lib/supabase/auth-gate.ts.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { url, publishableKey } = resolveServerSupabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
        // Supabase sends Cache-Control/Expires/Pragma headers with auth
        // cookies so a proxy or CDN never caches a response carrying one
        // user's session token. Forward them onto the response.
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value)
        );
      },
    },
  });

  // IMPORTANT: Do not run code between createServerClient and getClaims().
  // getClaims() validates and (if needed) refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  const decision = resolveAuthDecision({
    enforce: studioAuthEnforced(),
    hasClaims: Boolean(claims),
    hasInternalApiToken: hasValidStudioInternalApiToken({
      authorizationHeader: request.headers.get("authorization"),
    }),
    pathname: request.nextUrl.pathname,
  });

  // These deny/redirect branches only fire when there are no claims — i.e. the
  // session was not refreshed — so there are no new auth cookies to carry over,
  // and it is safe to return a fresh response without copying supabaseResponse's
  // cookies (unlike the allow path below).
  if (decision === "deny-api") {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }
  if (decision === "redirect-login") {
    const url = request.nextUrl.clone();
    url.pathname = withStudioBasePath("/login", resolveServerStudioBasePath());
    return NextResponse.redirect(url);
  }

  // IMPORTANT: return supabaseResponse as-is. If you create a new response,
  // copy over supabaseResponse.cookies or you'll desync the browser session.
  return supabaseResponse;
}
