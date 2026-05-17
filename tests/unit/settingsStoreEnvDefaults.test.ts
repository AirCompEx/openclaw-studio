// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadEnvGatewayDefaults, loadStudioSettings } from "@/lib/studio/settings-store";

const tmpDirs: string[] = [];
const makeTmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-settings-"));
  tmpDirs.push(dir);
  return dir;
};

describe("settings-store env seeding", () => {
  afterEach(() => {
    delete process.env.OPENCLAW_GATEWAY_URL;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.OPENCLAW_STATE_DIR;
    while (tmpDirs.length) {
      try { fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true }); } catch { /* ignore */ }
    }
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
    const tmpDir = makeTmpDir();
    process.env.OPENCLAW_STATE_DIR = tmpDir;
    process.env.OPENCLAW_GATEWAY_URL = "ws://openclaw-gateway:18789";
    process.env.OPENCLAW_GATEWAY_TOKEN = "tkn";
    expect(loadStudioSettings().gateway).toEqual({
      url: "ws://openclaw-gateway:18789",
      token: "tkn",
    });
  });

  it("loadStudioSettings uses env token but keeps settings.json url when gateway has no token", () => {
    const tmpDir = makeTmpDir();
    process.env.OPENCLAW_STATE_DIR = tmpDir;
    process.env.OPENCLAW_GATEWAY_URL = "ws://from-env:18789";
    process.env.OPENCLAW_GATEWAY_TOKEN = "env-token";

    const settingsDir = path.join(tmpDir, "openclaw-studio");
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsContent = JSON.stringify({
      version: 1,
      gateway: { url: "ws://from-settings:18789", token: "" },
    });
    fs.writeFileSync(path.join(settingsDir, "settings.json"), settingsContent, "utf8");

    expect(loadStudioSettings().gateway).toEqual({
      url: "ws://from-settings:18789",
      token: "env-token",
    });
  });
});
