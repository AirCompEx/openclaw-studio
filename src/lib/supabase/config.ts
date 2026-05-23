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
