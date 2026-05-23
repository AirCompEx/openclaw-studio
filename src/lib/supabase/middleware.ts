import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { resolveServerSupabaseConfig } from "@/lib/supabase/config";

/**
 * Refreshes the Supabase auth session on every matched request and rewrites the
 * auth cookies onto the response. This keeps server-rendered pages and Route
 * Handlers seeing a valid, non-expired session.
 *
 * NOTE: by default this only *refreshes* the session — it does not force
 * unauthenticated visitors to /login. The existing Studio UI/API is left
 * reachable so adding auth here doesn't lock anyone out before a user exists
 * and the Google provider is configured. To gate the app, uncomment the
 * redirect block below.
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

  // IMPORTANT: return supabaseResponse as-is. If you create a new response,
  // copy over supabaseResponse.cookies or you'll desync the browser session.
  return supabaseResponse;
}
