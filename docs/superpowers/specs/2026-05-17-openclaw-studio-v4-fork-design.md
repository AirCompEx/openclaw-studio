# OpenClaw Studio — v4-Compatible Fork (Design Spec)

- **Date:** 2026-05-17
- **Status:** Approved design — pre-implementation
- **Repos touched:** `AirCompEx/openclaw-studio` (this fork) and `AirCompEx/agents-platform`
- **Sub-project:** #1 of the eventual "SaaS of OpenClaw Studio". Auth, multi-tenancy,
  per-tenant gateway provisioning, and billing are **separate later specs** and are out
  of scope here.

## 1. Problem

`agents-platform` deploys OpenClaw Studio as a runtime component by running
`npx -y openclaw-studio@latest` in a bare `node:20-bookworm-slim` container (Next.js dev
mode). The published package is `grp06/openclaw-studio` — a third-party community
dashboard.

The OpenClaw Gateway (`ghcr.io/openclaw/openclaw:latest`, **OpenClaw 2026.5.12**) speaks
control-plane **protocol v4**. Studio's connect frame declares `minProtocol: 3,
maxProtocol: 3`. The Gateway rejects any range that excludes its version, so every
connection fails with `Control-plane connect rejected: INVALID_REQUEST protocol mismatch`
(gateway log: `[ws] protocol mismatch ... closed before connect`).

`grp06/openclaw-studio` has no v4 work (latest upstream commit 2026-03-19; no branches,
PRs, or issues mentioning v4). There is nothing to `npm install` — a fork is required.

## 2. Goal

A maintained fork — `AirCompEx/openclaw-studio` (already cloned at
`C:\Dev\AIRCOMPEX\openclaw-studio`) — that:

- connects to a v4 Gateway and works (single-tenant);
- is deployed as a **pinned production Docker image**, not `npx @latest` dev mode;
- requires **no manual token paste and no per-browser device pairing** to use.

Scope is deliberately **minimal**: only what is needed to connect and work.

## 3. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Fork home | Standalone repo `AirCompEx/openclaw-studio`. `agent-platform-app` consumes it later (per ADR 0002); it is not vendored now. |
| Deployment | Versioned Docker image, deployed by `agents-platform` (replaces `npx @latest`). |
| Fork depth | Minimal — only the v4 connect change and what keeps existing features working. |
| Access model | Internalize the Gateway: remove its public ingress; Studio reaches it cluster-internally; a single auth gate on Studio. |

## 4. Architecture (as-is — confirmed by reading the fork)

- Studio is a Next.js app with a custom Node server (`server/index.js`; `start` script =
  `node server/index.js`).
- **The Gateway connection is entirely server-side.** `src/lib/controlplane/openclaw-adapter.ts`
  is imported only by `src/app/api/**/route.ts` and other server-side `controlplane`
  modules — never by a client component. Flow: browser → Studio API routes
  (`/api/runtime/*`, `/api/intents/*`) → Studio server → Gateway WebSocket. The browser
  never opens a Gateway connection.
- `server/access-gate.js` gates browser→Studio: if `STUDIO_ACCESS_TOKEN` is set, `/api/*`
  requests and WS upgrades require cookie `studio_access`; `/?access_token=<token>` sets
  that cookie. Empty token ⇒ gate disabled.
- `server/network-policy.js` **refuses to start** Studio bound to a public host (e.g.
  `0.0.0.0`) unless `STUDIO_ACCESS_TOKEN` is set.
- Gateway connection settings are loaded server-side by `loadStudioSettings()`
  (`src/lib/studio/settings-store.ts`) from `settings.json`, falling back to a
  co-located `openclaw.json`. **There is no environment-variable source today.**
- The connect handshake in `openclaw-adapter.ts` is protocol-generic: it answers the
  Gateway's `connect.challenge` event, then treats the connect response by `parsed.ok`
  (success) vs `parsed.error` (rejection). It does not assert the negotiated protocol
  number.

## 5. Target end-state

- **Gateway:** `ClusterIP`-only (no public ingress), `auth.mode=none`. Safe because the
  service is unreachable from outside the cluster; OpenClaw skips device pairing entirely
  when `auth.mode=none`.
- **Studio:** our pinned image; connects to `ws://openclaw-gateway:18789` internally, with
  the gateway URL and token seeded from env vars; no device pairing needed. The token is
  still supplied because Studio's `loadGatewaySettings` (`openclaw-adapter.ts:178`) throws
  on an empty token — but under `auth.mode=none` the Gateway ignores it, so it is no
  longer a security boundary, just a value Studio's own check requires.
- **One gate:** Studio's access gate (`STUDIO_ACCESS_TOKEN`). Open Studio → pass one gate
  → connected. For the future SaaS, the access gate is replaced by the product's own auth.

### Why `auth.mode=none` is acceptable here

OpenClaw removed the shared-token device-pairing bypass (advisory GHSA-553v-f69r-656j), so
a token-authenticated Studio server would require a one-time device pairing it cannot
currently perform (its connect frame sends no device identity). `auth.mode=none` skips
pairing (confirmed: OpenClaw sets `skipPairing` true when `resolvedAuth.mode === "none"`).
The Gateway is no longer internet-facing, so removing Gateway-level auth does not create
an external exposure. The real gate (Studio access gate, later the SaaS auth) is intact.
Restoring Gateway token auth is a deferred item (§9).

## 6. Changes — fork (`AirCompEx/openclaw-studio`)

### F1 — Protocol bump
`src/lib/controlplane/openclaw-adapter.ts`: `CONNECT_PROTOCOL = 3` → `4`. This is the
single source; it feeds `buildGatewayConnectProfile`, producing `minProtocol: 4,
maxProtocol: 4`.

### F2 — Env-seeded Gateway connection
Add an environment-variable source so a fresh container connects with no UI interaction.
Modify `loadStudioSettings()` (`src/lib/studio/settings-store.ts`): introduce
`loadEnvGatewayDefaults()` reading `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`.
Resolution precedence for the gateway connection:

1. `settings.json` (UI-saved) when it has a gateway URL,
2. env vars (`OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_TOKEN`),
3. co-located `openclaw.json` defaults (existing behaviour),
4. `DEFAULT_GATEWAY_URL`.

The adapter consumes settings via `loadGatewaySettings()` (`openclaw-adapter.ts:170`),
which calls `loadStudioSettings()` and **throws if URL or token is empty**
(`openclaw-adapter.ts:176,178`). Therefore **both** env vars must be provided — the token
even though the Gateway ignores it under `auth.mode=none`. `loadGatewaySettings` itself is
left unchanged. The `StudioGatewaySettings` type (`{ url: string; token: string }`) and
`normalizeGatewayUrl` accept these values; `ws://openclaw-gateway:18789` is a non-loopback
host so it passes through `normalizeGatewayUrl` unmodified.

`settings.json` lives on the container's ephemeral filesystem, so env vars remain
authoritative across restarts; UI overrides are session-scoped, which is acceptable for
single-tenant. Relaxing the `loadGatewaySettings` empty-token check is deferred (§9).

### F3 — Test updates
- `tests/unit/openclawAdapter.test.ts` and `tests/unit/controlPlaneRuntime.test.ts`:
  8 mock `hello-ok` payloads carry `protocol: 3` → change to `4`. (Verified: the suite has
  no outgoing `minProtocol`/`maxProtocol` connect-frame assertions, so nothing else needs
  changing for the protocol bump.)
- Add a unit test for F2 env-seeding (env present → those values used; precedence order).

### F4 — Production Docker image
- Add `Dockerfile` (multi-stage: Node 20 build stage — the fork requires
  `engines.node >=20.9.0` — runs `npm ci` + `next build`; slim runtime stage carries
  `.next`, `server/`, `node_modules`, `package.json`) and `.dockerignore`. The custom
  server requires `next` at runtime, so the runtime `node_modules` must include
  production dependencies. The runtime stage sets `WORKDIR` to the app root and
  `CMD ["node", "server/index.js"]` — so consumers need not override the command. No dev
  mode.
- Image tag = `<package.json version>-<git short SHA>` (e.g. `0.1.0-ab12cd3`); also push a
  moving `latest` for convenience. Overlays pin the exact `version-sha` tag.
- Registry: `ghcr.io/aircompex/openclaw-studio` (default; overridable by ops).
- Build/push: a GitHub Actions workflow in the fork repo builds and pushes on a git tag.
  The first image may be built and pushed manually (`docker build` / `docker push`) to
  unblock verification; the workflow is part of this sub-project's deliverables.

## 7. Changes — `agents-platform`

### A1 — Studio deployment uses our image
`manifests/runtimes/openclaw/base/studio-deployment.yaml`: replace the
`node:20-bookworm-slim` container and the `command`/`args` running
`npx -y openclaw-studio@latest …` with the pinned image. The image's `CMD` already runs
`node server/index.js`, so the Deployment does **not** set `command`/`args`. Environment:

- `STUDIO_ACCESS_TOKEN` — from `openclaw-studio-secrets`. **Mandatory**: the pod binds
  `HOST=0.0.0.0` and `server/network-policy.js` refuses a public bind without it.
- `OPENCLAW_GATEWAY_URL=ws://openclaw-gateway:18789` — from the `openclaw-studio-config`
  ConfigMap.
- `OPENCLAW_GATEWAY_TOKEN` — from `openclaw-studio-secrets`; required non-empty by
  `loadGatewaySettings` (see F2), inert under `auth.mode=none`.
- `HOST=0.0.0.0`, `PORT=3000`.

Drop `NEXT_PUBLIC_GATEWAY_URL` (the browser never connects to the Gateway). Studio needs
**no PersistentVolume** — settings are env-seeded and the ephemeral filesystem is
sufficient; `OPENCLAW_STATE_DIR` may be kept or dropped (harmless either way). Pin the
image tag in both overlays' `images:` block.

**Image pull access:** the k3s cluster must be able to pull the image. Either publish
`ghcr.io/aircompex/openclaw-studio` as a public package, or create an `imagePullSecret`
in the `prd-openclaw`/`hprd-openclaw` namespaces and reference it from the Studio
Deployment (the deploy workflow would create the secret alongside the existing ones).
Public is simplest for a single-tenant prototype and is the assumed default.

### A2 — Internalize the Gateway
- Remove `gateway-ingress.yaml` from `manifests/runtimes/openclaw/base/kustomization.yaml`
  and delete the `gateway-ingress` patches in both overlays. The Gateway `Service` stays
  `ClusterIP`.
- **Disable Gateway auth via the config file.** The `--auth` CLI flag only accepts
  `token|password` — it cannot disable auth. So: in the bootstrap `openclaw.json` set
  `gateway.auth.mode: "none"`, and **remove `--auth token --token $(OPENCLAW_GATEWAY_TOKEN)`**
  from the gateway `command` in `gateway-deployment.yaml` (a CLI `--auth` would otherwise
  override the config).
- **initContainer reconcile.** The bootstrap initContainer currently copies/repairs
  `openclaw.json` only when the Studio origin string is missing — so a changed
  `auth.mode` would not reach an existing PVC. It must ensure `gateway.auth.mode: "none"`
  on every deploy, including existing PVCs. Recommended mechanism: rather than
  text-editing JSON in busybox (fragile), run the reconciliation with OpenClaw's own
  config writer — an initContainer step on the **gateway image** executing
  `node dist/index.js config set gateway.auth.mode none` with `OPENCLAW_CONFIG_PATH`
  pointed at the PVC file (atomic, schema-correct, idempotent). The existing busybox
  origin-repair step can be retired since `controlUi.allowedOrigins` is being removed.
  Final mechanism is fixed in the implementation plan.
- Bootstrap `openclaw.json`: keep `gateway.mode: "local"` (the Gateway refuses to start
  without it). `trustedProxies` and `controlUi.allowedOrigins` are no longer needed (they
  existed for the public/browser path) and may be removed.
- With `--token` removed from the gateway command, `OPENCLAW_GATEWAY_TOKEN` on the Gateway
  container and the `openclaw-gateway-secrets` Secret become unused. Leaving them is
  harmless; removing them also touches the deploy workflow's secret-creation step, so
  treat that cleanup as optional and out of this sub-project's critical path.
- Ops note (not a repo change): retire the public DNS record
  `openclaw-gateway.airexpert.cloud` and its TLS cert. For ad-hoc Gateway debugging use
  `kubectl port-forward` instead of the (now removed) public ingress.

### A3 — Docs
- `docs/v1/openclaw-system-contract.md`: Gateway is internal-only; Studio is the sole
  public surface; remove the two-public-endpoint model.
- `catalog/runtimes/openclaw.yaml` and `instances/*/openclaw.yaml`: Studio image
  reference; Gateway has no ingress.
- `docs/v1/technical-debt-register.md`: record `gateway.auth.mode=none` as an accepted
  single-tenant compromise, and record the pre-existing, unrelated
  `Requested agent harness "codex" is not registered` Gateway error as a known issue
  (it does not affect Studio connectivity and is fixed separately).

## 8. Verification (single-tenant, against `prd-openclaw`)

1. Build and push the image; deploy via `agents-platform` (Runtime deploy workflow).
2. Confirm the Gateway is `ClusterIP`-only with auth disabled and the Studio server
   reaches status `connected` — no `protocol mismatch`, no pairing prompt
   (`kubectl logs deploy/openclaw-gateway`, `deploy/openclaw-studio`).
3. Exercise existing features against the live Gateway: chat send/receive, agent
   list/create, sessions, approvals, cron. v4 keeps `message` as the cumulative assistant
   snapshot, so chat should render via cumulative snapshots. Fix only what is actually
   broken; if nothing else surfaces, the fork change is F1+F2 only.
4. Confirm the access gate: with `STUDIO_ACCESS_TOKEN` set, `/api/*` needs the cookie and
   `/?access_token=<token>` sets it; opening Studio then lands connected.
5. `npm test` (vitest) — all green.

## 9. Out of scope / deferred

- Multi-tenancy, auth (Supabase), per-tenant Gateway provisioning, billing — later specs.
- `deltaText` incremental streaming (v4 optimization); cumulative `message` is sufficient.
- `legacy-control-ui` vs `backend` connect-profile cleanup.
- Restoring Gateway token auth — would reintroduce device pairing, which needs new fork
  work (persisted device identity + pairing handshake). Only relevant if the Gateway is
  ever re-exposed.
- Relaxing `loadGatewaySettings`'s non-empty-token requirement, so `auth.mode=none`
  deployments need no placeholder token. Cosmetic; not worth a behaviour change now.
- Running Studio as a sidecar in the Gateway pod for genuine loopback.

## 10. Risks

- *"Minimal" may be incomplete:* OpenClaw docs do not fully enumerate v3→v4. Mitigated —
  the connect handshake is protocol-generic and the message path reads the v4-preserved
  cumulative `message`; verification step 3 catches anything else before sign-off.
- *Connect-frame trigger under `auth.mode=none`:* the adapter sends its connect frame only
  in response to the Gateway's `connect.challenge` event. The challenge was observed in
  every raw probe regardless of auth, so it is assumed to be part of the connect handshake
  independent of `auth.mode`. If `auth.mode=none` suppressed it, the adapter would
  `CONNECT_TIMEOUT`; verification step 2 detects this, and the fallback (send the connect
  frame on socket open) would then be a small, well-scoped fork change.
- *initContainer reconcile correctness:* using OpenClaw's own `config set` (A2) writes the
  key atomically and idempotently, avoiding fragile text editing. The reconcile must not
  clobber other Gateway runtime state in `openclaw.json` — `config set` mutates only the
  named key, which satisfies this.
