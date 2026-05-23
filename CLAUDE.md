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

## Background — why this fork exists (read this first)

OpenClaw is two separate components: the **Gateway** (the runtime/orchestrator) and
**Studio** (this web dashboard). They are released and versioned independently.

The AirCompEx platform runs OpenClaw Gateway `2026.5.x`, whose control-plane protocol is
**v4**. The upstream community package `grp06/openclaw-studio` only speaks protocol **v3**
and is effectively dormant (no v4 work, no recent releases). Result: the published
`openclaw-studio` could not connect to the platform's Gateway *at all* — every attempt was
rejected with `protocol mismatch`. There was no newer version to install and no upstream
fix coming, so **forking was the only way to get a working Studio**.

Forking Studio — rather than just using the Gateway's own built-in "Control UI" — is
deliberate: the long-term goal is a **multi-tenant SaaS built on Studio**. This fork is
*sub-project #1* of that effort: get Studio connecting to a v4 Gateway and shipped as a
real, pinned image. Real customer auth, multi-tenancy, and billing are explicitly
**later, separate sub-projects** — they are not in this fork yet.

The complete problem statement, options considered, decisions, and trade-offs are in
`docs/superpowers/specs/2026-05-17-openclaw-studio-v4-fork-design.md`; the task-by-task
implementation record is the sibling `plans/` file.

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

## How the app is wired (read `ARCHITECTURE.md` for the full version)

Next.js 16 (App Router) + React 19, served by a **custom Node server** (`server/index.js`),
not `next start`. Single runtime architecture with two browser-facing paths plus one
server-owned upstream link:

1. **Browser → Studio HTTP**: reads via `/api/runtime/*`, mutations via `/api/intents/*`.
2. **Browser → Studio SSE**: `/api/runtime/stream` (live runtime events + replay).
3. **Studio server → Gateway**: one server-owned WebSocket opened by the Node process.

Studio connects to the Gateway **entirely server-side**: `openclaw-adapter.ts` is
imported only by `src/app/api/**/route.ts`. The browser never opens a gateway transport.
So `OPENCLAW_GATEWAY_URL` is a server-side, in-cluster URL (e.g.
`ws://openclaw-gateway:18789`), **not** browser-facing — there is no `NEXT_PUBLIC_`
gateway URL.

Key modules:

- **Control plane** (`src/lib/controlplane/`): `openclaw-adapter.ts` (WS lifecycle,
  handshake, request **allowlist**, reconnect), `runtime.ts` (process-local singleton,
  subscription fanout), `projection-store.ts` (SQLite projection + replay **outbox** in
  `runtime.db`). Route handlers bootstrap the runtime through
  `runtime-route-bootstrap.ts` / `intent-route.ts` and get a deterministic
  `GATEWAY_UNAVAILABLE` shape when the upstream is down.
- **Settings** (`src/lib/studio/settings-store.ts`, `src/app/api/studio/route.ts`):
  persisted to `~/.openclaw/openclaw-studio/settings.json`; gateway token is
  server-custodied and redacted from API responses; URL/token changes trigger a
  deterministic reconnect.
- **UI** (`src/app/page.tsx`, `src/features/agents/**`): top-level wiring of settings
  load, fleet bootstrap, stream subscription, and history load-more.

Guardrails (from `ARCHITECTURE.md`): don't reintroduce a browser-direct gateway
transport; don't add `/api/gateway/*` routes (the namespace was re-homed to
`/api/runtime/*` + `/api/intents/*`); keep the gateway method allowlist explicit in
`openclaw-adapter.ts`; keep token redaction server-side; keep `runtime.db` migrations
additive.

## Working with upstream OpenClaw

Per `AGENTS.md`: the OpenClaw Gateway source lives at `~/openclaw`. **Do not modify it** —
changes belong in this Studio app. Read the Gateway source when you need to understand the
control-plane protocol or how a request/intent is handled upstream.

## Build & run

- `npm run dev` — dev server (custom Node server: `server/index.js --dev`).
- `npm run build` then `npm start` — production (`node server/index.js`).
- `npm run typecheck` — `tsc --noEmit`. `npm run lint` — `eslint .`.
- `npm test` — Vitest unit tests (jsdom; only `tests/unit/**/*.test.ts`). Run one file
  with `npx vitest run tests/unit/<name>.test.ts`, or a single case with `-t "<name>"`.
- `npm run e2e` — Playwright (`playwright.config.ts`); `tests/e2e/**` is excluded from
  Vitest and runs only here.
- The Docker image's `CMD` is `node server/index.js`. `server/network-policy.js` refuses a
  public bind (`HOST=0.0.0.0`/`::`/non-loopback host) unless `STUDIO_ACCESS_TOKEN` is set.
- `server/index.js` runs a `better-sqlite3` native-ABI check at startup unless
  `OPENCLAW_SKIP_NATIVE_RUNTIME_VERIFY=1` is set (the production deployment sets it). Dev
  auto-`--repair`s the native module via `predev`; `prestart` is check-only. To fix a
  `NODE_MODULE_VERSION` mismatch by hand: `npm run verify:native-runtime:repair`.

## Required GitHub Actions secrets

Set in **this repo's** Settings → Secrets and variables → Actions, for `docker-build.yml`:

| Secret | Value |
|---|---|
| `DOCKER_HUB_USERNAME` | `systemease` (the Docker Hub account; also forms the image name `systemease/openclaw-studio`). |
| `DOCKER_HUB_ACCESS_TOKEN` | A Docker Hub **personal access token** with Read & Write scope (hub.docker.com → Account settings → Personal access tokens) — not the account password. |

The runtime/deploy secrets (`OPENCLAW_GATEWAY_TOKEN_*`, `OPENCLAW_STUDIO_ACCESS_TOKEN_*`)
live in the separate `agents-platform` repo, not here.

## Releasing & versioning

Versions follow a **`YY.MM`** scheme (`package.json` `version`, e.g. `26.05`), enforced by
`scripts/version-handler.js` (regex `^\d{2}\.\d{2}$`). Cut a release with **`npm run
release`** from a clean `main`: it pulls `--ff-only`, runs `npm run build`, then tags the
current version. If that tag already exists it bumps the minor (`.99` rolls to next major
`.00`), commits `Hotfix [..]`, and pushes branch + tag (rolling back the local tag/commit
if the push fails).

`docker-build.yml` triggers on the default branch **and** on tags matching `v*` or
`[0-9][0-9].[0-9][0-9]`, so a `26.05` tag builds and pushes an image tagged `26.05` (the
default branch also publishes `:latest`). The `agents-platform` deployment should pin one
of these version tags rather than `:latest`.

## Deployment

Deployed by the separate `agents-platform` repo as the OpenClaw runtime's `studio`
component — a pinned image tag, not `npx`. In that deployment the Gateway is
cluster-internal with auth disabled, and Studio (gated by `STUDIO_ACCESS_TOKEN`) is the
stack's sole public surface.
