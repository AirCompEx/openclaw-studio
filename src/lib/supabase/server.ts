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
