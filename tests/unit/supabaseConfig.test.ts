// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveServerSupabaseConfig } from "@/lib/supabase/config";

describe("resolveServerSupabaseConfig", () => {
  it("prefers non-public SUPABASE_* vars", () => {
    const cfg = resolveServerSupabaseConfig({
      SUPABASE_URL: "https://runtime.example",
      SUPABASE_PUBLISHABLE_KEY: "sb_runtime",
      NEXT_PUBLIC_SUPABASE_URL: "https://build.example",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_build",
    });
    expect(cfg).toEqual({
      url: "https://runtime.example",
      publishableKey: "sb_runtime",
    });
  });

  it("falls back to NEXT_PUBLIC_* when non-public unset", () => {
    const cfg = resolveServerSupabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://build.example",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_build",
    });
    expect(cfg).toEqual({
      url: "https://build.example",
      publishableKey: "sb_build",
    });
  });

  it("returns empty strings when nothing set", () => {
    expect(resolveServerSupabaseConfig({})).toEqual({
      url: "",
      publishableKey: "",
    });
  });

  it("trims whitespace from values", () => {
    expect(
      resolveServerSupabaseConfig({ SUPABASE_URL: "  https://x  " }).url
    ).toBe("https://x");
  });

  it("falls back per-field when only one non-public var is set", () => {
    const cfg = resolveServerSupabaseConfig({
      SUPABASE_URL: "https://only-url",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_pub",
    });
    expect(cfg).toEqual({
      url: "https://only-url",
      publishableKey: "sb_pub",
    });
  });
});
