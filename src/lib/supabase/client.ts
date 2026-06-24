import { createBrowserClient } from "@supabase/ssr";

import { readStudioPublicConfig } from "@/lib/studio/base-path";

/**
 * Reads the Supabase public config in the browser. In production the
 * `NEXT_PUBLIC_*` values are frozen empty at build time (the image is built
 * with no build args), so the real values arrive at runtime via
 * `window.__STUDIO_PUBLIC_CONFIG__`, injected by the root layout. The
 * `NEXT_PUBLIC_*` fallback keeps local `npm run dev` working.
 */
function readBrowserSupabaseConfig(): { url: string; key: string } {
  const injected = readStudioPublicConfig();

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
