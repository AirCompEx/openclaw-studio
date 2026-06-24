import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerStudioBasePath, withStudioBasePath } from "@/lib/studio/base-path";

/**
 * OAuth (and PKCE) callback. Supabase redirects here with a `code` after the
 * user authenticates with Google; we exchange it for a session cookie.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Where to send the user after a successful login. Guard against open
  // redirects by only allowing same-origin relative paths.
  let next = searchParams.get("next") ?? "/";
  if (!next.startsWith("/")) {
    next = "/";
  }
  next = withStudioBasePath(next, resolveServerStudioBasePath());

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return NextResponse.redirect(
    `${origin}${withStudioBasePath("/login?error=oauth", resolveServerStudioBasePath())}`
  );
}
