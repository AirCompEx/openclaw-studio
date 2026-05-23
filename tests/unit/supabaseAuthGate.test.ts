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
