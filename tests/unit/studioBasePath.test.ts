import { describe, expect, it } from "vitest";

import {
  normalizeStudioBasePath,
  withStudioBasePath,
} from "@/lib/studio/base-path";

describe("studio base path", () => {
  it("normalizes empty and root values to no base path", () => {
    expect(normalizeStudioBasePath("")).toBe("");
    expect(normalizeStudioBasePath("/")).toBe("");
    expect(normalizeStudioBasePath(undefined)).toBe("");
  });

  it("normalizes runtime paths", () => {
    expect(normalizeStudioBasePath("runtimes/abc/")).toBe("/runtimes/abc");
    expect(normalizeStudioBasePath("/runtimes/abc/")).toBe("/runtimes/abc");
  });

  it("prefixes absolute studio hrefs without double-prefixing", () => {
    expect(withStudioBasePath("/", "/runtimes/abc")).toBe("/runtimes/abc/");
    expect(withStudioBasePath("/login", "/runtimes/abc")).toBe("/runtimes/abc/login");
    expect(withStudioBasePath("/?settingsAgentId=main", "/runtimes/abc")).toBe(
      "/runtimes/abc/?settingsAgentId=main"
    );
    expect(withStudioBasePath("/runtimes/abc/login", "/runtimes/abc")).toBe(
      "/runtimes/abc/login"
    );
  });
});
