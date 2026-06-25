// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  hasValidStudioInternalApiToken,
  resolveAuthDecision,
  studioInternalApiToken,
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

describe("studioInternalApiToken", () => {
  it("prefers STUDIO_INTERNAL_API_TOKEN and falls back to OPENCLAW_GATEWAY_TOKEN", () => {
    expect(
      studioInternalApiToken({
        STUDIO_INTERNAL_API_TOKEN: " internal-token ",
        OPENCLAW_GATEWAY_TOKEN: "gateway-token",
      })
    ).toBe("internal-token");
    expect(
      studioInternalApiToken({
        OPENCLAW_GATEWAY_TOKEN: " gateway-token ",
      })
    ).toBe("gateway-token");
  });

  it("validates bearer tokens", () => {
    expect(
      hasValidStudioInternalApiToken({
        authorizationHeader: "Bearer secret",
        env: { STUDIO_INTERNAL_API_TOKEN: "secret" },
      })
    ).toBe(true);
    expect(
      hasValidStudioInternalApiToken({
        authorizationHeader: "Bearer wrong",
        env: { STUDIO_INTERNAL_API_TOKEN: "secret" },
      })
    ).toBe(false);
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

    expect(
      resolveAuthDecision({
        enforce: true,
        hasClaims: false,
        pathname: "/control",
      })
    ).toBe("allow");

    expect(
      resolveAuthDecision({
        enforce: true,
        hasClaims: false,
        pathname: "/control/assets/app.js",
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

  it("allows internal bearer access only for intent APIs", () => {
    expect(
      resolveAuthDecision({
        enforce: true,
        hasClaims: false,
        hasInternalApiToken: true,
        pathname: "/api/intents/agent-create",
      })
    ).toBe("allow");
    expect(
      resolveAuthDecision({
        enforce: true,
        hasClaims: false,
        hasInternalApiToken: true,
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
