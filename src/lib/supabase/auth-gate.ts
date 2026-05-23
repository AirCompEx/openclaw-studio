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
