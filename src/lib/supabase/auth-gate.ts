export type AuthDecision = "allow" | "redirect-login" | "deny-api";

type EnvLike = Record<string, string | undefined>;

/** True only when Studio is configured to enforce Supabase browser auth. */
export function studioAuthEnforced(env: EnvLike = process.env): boolean {
  return String(env.STUDIO_AUTH_MODE ?? "").trim().toLowerCase() === "supabase";
}

export function studioInternalApiToken(env: EnvLike = process.env): string {
  return String(env.STUDIO_INTERNAL_API_TOKEN ?? env.OPENCLAW_GATEWAY_TOKEN ?? "").trim();
}

export function hasValidStudioInternalApiToken(args: {
  authorizationHeader: string | null;
  env?: EnvLike;
}): boolean {
  const token = studioInternalApiToken(args.env);
  if (!token) return false;
  const header = String(args.authorizationHeader ?? "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return header.slice("bearer ".length).trim() === token;
}

/**
 * Pure access decision for the proxy. Public routes (`/login`, `/auth/*`) are
 * always allowed so login can happen; unauthenticated API requests get a 401,
 * unauthenticated page requests are redirected to `/login`.
 */
export function resolveAuthDecision(args: {
  enforce: boolean;
  hasClaims: boolean;
  hasInternalApiToken?: boolean;
  pathname: string;
}): AuthDecision {
  const { enforce, hasClaims, hasInternalApiToken = false, pathname } = args;
  if (!enforce) return "allow";
  if (hasClaims) return "allow";
  if (hasInternalApiToken && pathname.startsWith("/api/intents/")) return "allow";
  if (pathname === "/login" || pathname.startsWith("/auth/")) return "allow";
  if (pathname === "/control" || pathname.startsWith("/control/")) return "allow";
  if (pathname.startsWith("/api/")) return "deny-api";
  return "redirect-login";
}
