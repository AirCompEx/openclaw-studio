# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is **AirCompEx's fork of `grp06/openclaw-studio`** — a web dashboard ("OpenClaw
Studio") for an OpenClaw Gateway. The fork exists to keep Studio compatible with the
OpenClaw Gateway version AirCompEx runs and to package it for deployment on the AirCompEx
k3s cluster.

`AGENTS.md` holds the upstream project's general guidance. This file documents the
**fork-specific** decisions; where they overlap, the deployment reality described here
wins. The design spec and implementation plan for the fork work are in
`docs/superpowers/`.

## Fork-specific changes vs upstream

The platform runs OpenClaw Gateway `2026.5.x`, whose control-plane protocol is **v4**.
Upstream `openclaw-studio` spoke v3, which the Gateway rejects with `protocol mismatch`.
The fork's deltas:

- **`src/lib/controlplane/openclaw-adapter.ts` — `CONNECT_PROTOCOL = 4`.** This single
  constant feeds the connect frame's `minProtocol`/`maxProtocol`. It must match the
  deployed Gateway's protocol version — keeping it aligned when pulling upstream changes
  or upgrading the Gateway is the main ongoing maintenance task.
- **Env-seeded gateway connection** (`src/lib/studio/settings-store.ts`).
  `loadEnvGatewayDefaults()` reads `OPENCLAW_GATEWAY_URL` + `OPENCLAW_GATEWAY_TOKEN`;
  `loadStudioSettings()` resolves the gateway connection in this precedence: UI-saved
  `settings.json` → env vars → co-located `openclaw.json` → built-in default. This lets a
  container connect with no UI interaction. Note `loadGatewaySettings()` in
  `openclaw-adapter.ts` throws if URL or token is empty, so both env vars must be set.
- **`Dockerfile` + `.dockerignore`** — a pinned production image (multi-stage: build on
  `node:20-bookworm` so the `better-sqlite3` native module can compile, runtime on
  `node:20-bookworm-slim`). `.github/workflows/docker-build.yml` builds and pushes the
  image to **Docker Hub** as `systemease/openclaw-studio` (login via the
  `DOCKER_HUB_USERNAME` / `DOCKER_HUB_ACCESS_TOKEN` repo secrets), on pushes to the
  default branch and on `v*` tags — matching the `aircompex` repo's workflow convention.

## Architecture note that matters

Studio connects to the Gateway **entirely server-side**: `openclaw-adapter.ts` is
imported only by `src/app/api/**/route.ts`. The browser talks only to Studio's Next.js
API routes; Studio's Node server holds the Gateway WebSocket. So `OPENCLAW_GATEWAY_URL` is
a server-side, in-cluster URL (e.g. `ws://openclaw-gateway:18789`), **not** a
browser-facing one — there is no `NEXT_PUBLIC_` gateway URL.

## Build & run

- `npm run dev` — dev server (custom Node server: `server/index.js --dev`).
- `npm run build` then `npm start` — production (`node server/index.js`).
- `npm test` — Vitest. `npm run typecheck` — `tsc --noEmit`.
- The Docker image's `CMD` is `node server/index.js`. `server/network-policy.js` refuses a
  public bind (`HOST=0.0.0.0`) unless `STUDIO_ACCESS_TOKEN` is set.
- `server/index.js` runs a `better-sqlite3` native-ABI check at startup unless
  `OPENCLAW_SKIP_NATIVE_RUNTIME_VERIFY=1` is set (the production deployment sets it).

## Deployment

Deployed by the separate `agents-platform` repo as the OpenClaw runtime's `studio`
component — a pinned image tag, not `npx`. In that deployment the Gateway is
cluster-internal with auth disabled, and Studio (gated by `STUDIO_ACCESS_TOKEN`) is the
stack's sole public surface.
