// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadEnvGatewayDefaults, loadStudioSettings } from "@/lib/studio/settings-store";

describe("settings-store env seeding", () => {
  afterEach(() => {
    delete process.env.OPENCLAW_GATEWAY_URL;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.OPENCLAW_STATE_DIR;
  });

  it("loadEnvGatewayDefaults returns null when no env vars are set", () => {
    expect(loadEnvGatewayDefaults()).toBeNull();
  });

  it("loadEnvGatewayDefaults returns url and token when both env vars are set", () => {
    process.env.OPENCLAW_GATEWAY_URL = "ws://openclaw-gateway:18789";
    process.env.OPENCLAW_GATEWAY_TOKEN = "tkn";
    expect(loadEnvGatewayDefaults()).toEqual({
      url: "ws://openclaw-gateway:18789",
      token: "tkn",
    });
  });

  it("loadEnvGatewayDefaults returns null when only the URL is set", () => {
    process.env.OPENCLAW_GATEWAY_URL = "ws://openclaw-gateway:18789";
    expect(loadEnvGatewayDefaults()).toBeNull();
  });

  it("loadEnvGatewayDefaults returns null when only the token is set", () => {
    process.env.OPENCLAW_GATEWAY_TOKEN = "tkn";
    expect(loadEnvGatewayDefaults()).toBeNull();
  });

  it("loadStudioSettings uses env defaults when no settings.json exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-settings-"));
    process.env.OPENCLAW_STATE_DIR = tmpDir;
    process.env.OPENCLAW_GATEWAY_URL = "ws://openclaw-gateway:18789";
    process.env.OPENCLAW_GATEWAY_TOKEN = "tkn";
    expect(loadStudioSettings().gateway).toEqual({
      url: "ws://openclaw-gateway:18789",
      token: "tkn",
    });
  });
});
