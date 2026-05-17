# OpenClaw Studio v4-Compatible Fork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `AirCompEx/openclaw-studio` fork connect to a v4 OpenClaw Gateway, ship it as a pinned Docker image, and reconfigure `agents-platform` so the Gateway is cluster-internal and Studio is the single access gate.

**Architecture:** Studio already connects to the Gateway entirely server-side (the browser only talks to Studio's Next.js API routes). The fix is a protocol-version bump plus env-seeded connection settings, packaged as a production image. `agents-platform` removes the Gateway's public ingress and disables Gateway auth (`auth.mode=none`) — safe because the Gateway is no longer internet-facing.

**Tech Stack:** TypeScript, Next.js (custom Node server), `ws`, Vitest, Docker, Kubernetes (Kustomize), GitHub Actions.

**Source spec:** `docs/superpowers/specs/2026-05-17-openclaw-studio-v4-fork-design.md`

**Branches:** Fork work (Tasks 1–5) on `feat/v4-protocol` in `C:\Dev\AIRCOMPEX\openclaw-studio`. `agents-platform` work (Tasks 6–9) on `feat/openclaw-studio-v4` in `C:\Dev\AIRCOMPEX\agents-platform`.

---

## File Structure

**Fork (`openclaw-studio`):**
- Modify: `src/lib/controlplane/openclaw-adapter.ts` — protocol constant.
- Modify: `src/lib/studio/settings-store.ts` — env-var gateway-settings source.
- Modify: `tests/unit/openclawAdapter.test.ts`, `tests/unit/controlPlaneRuntime.test.ts` — mock protocol version + new tests.
- Create: `Dockerfile`, `.dockerignore`, `.github/workflows/docker-image.yml`.

**`agents-platform`:**
- Modify: `manifests/runtimes/openclaw/base/studio-deployment.yaml`, `studio-configmap.yaml`, `gateway-deployment.yaml`, `gateway-bootstrap-configmap.yaml`, `kustomization.yaml`.
- Delete: `manifests/runtimes/openclaw/base/gateway-ingress.yaml`, both overlays' `patches/gateway-ingress.yaml`, both overlays' `patches/studio-configmap.yaml`, both overlays' `patches/gateway-bootstrap-configmap.yaml`.
- Modify: both overlays' `kustomization.yaml`.
- Modify: `docs/v1/openclaw-system-contract.md`, `docs/v1/technical-debt-register.md`, `catalog/runtimes/openclaw.yaml`, `instances/{hprd,prd}/openclaw.yaml`.

---

## Task 1: Bump connect protocol to v4 (fork)

**Files:**
- Modify: `src/lib/controlplane/openclaw-adapter.ts:25`
- Test: `tests/unit/openclawAdapter.test.ts`

- [ ] **Step 1: Create the branch**

Branch from `spec/v4-fork-design` (not `main`) so the spec and this plan file travel with
the implementation branch — the executing skill tracks task checkboxes in the plan file.

```bash
cd /c/Dev/AIRCOMPEX/openclaw-studio
git checkout spec/v4-fork-design && git checkout -b feat/v4-protocol
```

- [ ] **Step 2: Write the failing test**

Add this test inside the `describe("OpenClawGatewayAdapter", …)` block in `tests/unit/openclawAdapter.test.ts`:

```ts
it("declares protocol v4 in the connect frame", async () => {
  const sentFrames: Array<{ method?: string; params?: Record<string, unknown> }> = [];

  class RecordingSocket extends EventEmitter {
    readyState: number = WebSocket.OPEN;
    close() {
      if (this.readyState === WebSocket.CLOSED) return;
      this.readyState = WebSocket.CLOSED;
      this.emit("close");
    }
    terminate() {
      this.close();
    }
    send(raw: string, callback?: (err?: Error) => void) {
      const parsed = JSON.parse(raw) as {
        id?: string;
        method?: string;
        params?: Record<string, unknown>;
      };
      sentFrames.push(parsed);
      callback?.();
      if (parsed.method === "connect" && parsed.id) {
        queueMicrotask(() => {
          this.emit(
            "message",
            JSON.stringify({
              type: "res",
              id: parsed.id,
              ok: true,
              payload: { type: "hello-ok", protocol: 4 },
            })
          );
        });
      }
    }
  }

  const socket = new RecordingSocket();
  const adapter = new OpenClawGatewayAdapter({
    loadSettings: () => ({ url: "ws://127.0.0.1:9", token: "tkn" }),
    createWebSocket: () => socket as unknown as WebSocket,
  });

  queueMicrotask(() => {
    socket.emit(
      "message",
      JSON.stringify({ type: "event", event: "connect.challenge", payload: {} })
    );
  });

  await adapter.start();

  const connectFrame = sentFrames.find((f) => f.method === "connect");
  expect(connectFrame?.params?.minProtocol).toBe(4);
  expect(connectFrame?.params?.maxProtocol).toBe(4);

  await adapter.stop();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- openclawAdapter`
Expected: FAIL — `expected 3 to be 4` on the `minProtocol` assertion.

- [ ] **Step 4: Make the change**

In `src/lib/controlplane/openclaw-adapter.ts`, change the constant (currently line 25):

```ts
const CONNECT_PROTOCOL = 4;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- openclawAdapter`
Expected: PASS — all tests in the file green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/controlplane/openclaw-adapter.ts tests/unit/openclawAdapter.test.ts
git commit -m "feat: declare gateway control-plane protocol v4"
```

---

## Task 2: Update existing mock `hello-ok` protocol version (fork)

The adapter does not validate the response protocol number, so the existing mocks still pass — but they should reflect v4 for accuracy.

**Files:**
- Modify: `tests/unit/openclawAdapter.test.ts`
- Modify: `tests/unit/controlPlaneRuntime.test.ts`

- [ ] **Step 1: Replace the mock protocol version in both files**

In `tests/unit/openclawAdapter.test.ts` and `tests/unit/controlPlaneRuntime.test.ts`, replace every occurrence of:

```ts
payload: { type: "hello-ok", protocol: 3 },
```

with:

```ts
payload: { type: "hello-ok", protocol: 4 },
```

There are 8 occurrences total (5 in `openclawAdapter.test.ts`, 3 in `controlPlaneRuntime.test.ts`). Verify none remain:

Run: `git grep -n '"hello-ok", protocol: 3' tests/`
Expected: no output.

- [ ] **Step 2: Run the affected suites**

Run: `npm test -- openclawAdapter controlPlaneRuntime`
Expected: PASS — both suites green.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/openclawAdapter.test.ts tests/unit/controlPlaneRuntime.test.ts
git commit -m "test: align mock hello-ok payloads with protocol v4"
```

---

## Task 3: Env-seeded gateway connection settings (fork)

Lets a fresh container connect with no UI interaction. The adapter's `loadGatewaySettings()` (`openclaw-adapter.ts:170`) throws if URL **or** token is empty, so both env vars must be supplied.

**Files:**
- Modify: `src/lib/studio/settings-store.ts`
- Test: `tests/unit/settingsStoreEnvDefaults.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/settingsStoreEnvDefaults.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- settingsStoreEnvDefaults`
Expected: FAIL — `loadEnvGatewayDefaults` is not exported / not a function.

- [ ] **Step 3: Implement `loadEnvGatewayDefaults` and weave it into `loadStudioSettings`**

In `src/lib/studio/settings-store.ts`, add these two functions immediately **after** the
existing `loadLocalGatewayDefaults` export (so both are defined before `loadStudioSettings`, which uses `resolveGatewayDefaults`):

```ts
export const loadEnvGatewayDefaults = (): { url: string; token: string } | null => {
  const url = process.env.OPENCLAW_GATEWAY_URL?.trim() ?? "";
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ?? "";
  if (!url || !token) return null;
  return { url, token };
};

const resolveGatewayDefaults = (): { url: string; token: string } | null =>
  loadEnvGatewayDefaults() ?? loadLocalGatewayDefaults();
```

Then, in the existing `loadStudioSettings` function, replace **both** calls to
`loadLocalGatewayDefaults()` with `resolveGatewayDefaults()`. The resulting function body:

```ts
export const loadStudioSettings = (): StudioSettings => {
  const settingsPath = resolveStudioSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    const defaults = defaultStudioSettings();
    const gateway = resolveGatewayDefaults();
    return gateway ? { ...defaults, gateway } : defaults;
  }
  const raw = fs.readFileSync(settingsPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const settings = normalizeStudioSettings(parsed);
  if (!settings.gateway?.token) {
    const gateway = resolveGatewayDefaults();
    if (gateway) {
      return {
        ...settings,
        gateway: settings.gateway?.url?.trim()
          ? { url: settings.gateway.url.trim(), token: gateway.token }
          : gateway,
      };
    }
  }
  return settings;
};
```

This gives the precedence: UI-saved `settings.json` → env vars → co-located `openclaw.json` → `DEFAULT_GATEWAY_URL`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- settingsStoreEnvDefaults`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Run typecheck and the full unit suite**

Run: `npm run typecheck` then `npm test`
Expected: `tsc --noEmit` reports no errors; all Vitest suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/studio/settings-store.ts tests/unit/settingsStoreEnvDefaults.test.ts
git commit -m "feat: seed gateway connection from OPENCLAW_GATEWAY_URL/TOKEN env"
```

---

## Task 4: Production Dockerfile (fork)

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.next
.git
test-results
tests
docs
*.md
.github
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# Build stage uses the FULL bookworm image: it has python3/make/g++ so the
# better-sqlite3 native module can compile if no prebuilt binary is available.
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["node", "server/index.js"]
```

`node:20-bookworm` (build) and `node:20-bookworm-slim` (runtime) share the same Node
version and glibc, so a native module compiled in the build stage loads in the runtime
stage. `scripts/` is copied because `server/index.js` resolves
`scripts/verify-native-runtime.mjs` (it only skips it when
`OPENCLAW_SKIP_NATIVE_RUNTIME_VERIFY=1`).

- [ ] **Step 3: Build the image locally to verify**

Run: `docker build -t openclaw-studio:dev .`
Expected: build completes; final image created.

- [ ] **Step 4: Smoke-test the image starts**

Run:
```bash
docker run --rm -d --name studio-smoke \
  -e HOST=127.0.0.1 -e PORT=3000 -e OPENCLAW_SKIP_NATIVE_RUNTIME_VERIFY=1 \
  -p 3000:3000 openclaw-studio:dev
sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
docker stop studio-smoke
```
Expected: prints `200`. Notes: bind to `127.0.0.1` so `network-policy.js` does not require
`STUDIO_ACCESS_TOKEN`; `OPENCLAW_SKIP_NATIVE_RUNTIME_VERIFY=1` mirrors the production
deployment.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: add production Dockerfile"
```

---

## Task 5: CI workflow to build and push the image (fork)

**Files:**
- Create: `.github/workflows/docker-image.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Docker image

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

jobs:
  build-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Resolve image tag
        id: tag
        run: |
          set -euo pipefail
          VERSION="$(node -p "require('./package.json').version")"
          SHA="$(git rev-parse --short HEAD)"
          echo "tag=${VERSION}-${SHA}" >> "$GITHUB_OUTPUT"

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            systemease/openclaw-studio:${{ steps.tag.outputs.tag }}
            systemease/openclaw-studio:latest
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/docker-image.yml')); print('OK')"`
Expected: prints `OK`. (If `python3`/`pyyaml` is unavailable, instead confirm the file
parses in a YAML-aware editor — GitHub also validates the workflow on push.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/docker-image.yml
git commit -m "ci: build and push studio image to GHCR on tag"
```

- [ ] **Step 4: Build and push the first image manually (unblocks Task 6 verification)**

Run (operator must be logged in to GHCR — `docker login ghcr.io`):
```bash
docker build -t systemease/openclaw-studio:0.1.0-local .
docker push systemease/openclaw-studio:0.1.0-local
```
Expected: push succeeds. Note: make the GHCR package **public**, or arrange an `imagePullSecret` (see Task 6). Record the exact pushed tag — it is used in Task 6.

---

## Task 6: Studio deployment uses our image (`agents-platform`)

**Files:**
- Modify: `manifests/runtimes/openclaw/base/studio-deployment.yaml`
- Modify: `manifests/runtimes/openclaw/base/studio-configmap.yaml`
- Modify: `manifests/runtimes/openclaw/overlays/hprd/kustomization.yaml`
- Modify: `manifests/runtimes/openclaw/overlays/prd/kustomization.yaml`
- Delete: `manifests/runtimes/openclaw/overlays/hprd/patches/studio-configmap.yaml`
- Delete: `manifests/runtimes/openclaw/overlays/prd/patches/studio-configmap.yaml`

- [ ] **Step 1: Create the branch**

```bash
cd /c/Dev/AIRCOMPEX/agents-platform
git checkout main && git checkout -b feat/openclaw-studio-v4
```

- [ ] **Step 2: Replace the Studio container in `studio-deployment.yaml`**

Replace the `containers:` entry so it reads exactly:

```yaml
      containers:
        - name: studio
          image: systemease/openclaw-studio:0.1.0-local
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
          envFrom:
            - configMapRef:
                name: openclaw-studio-config
            - secretRef:
                name: openclaw-studio-secrets
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "2"
              memory: "2Gi"
          readinessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 20
            periodSeconds: 15
          livenessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 60
            periodSeconds: 30
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - NET_RAW
                - NET_ADMIN
```

This removes the `command`/`args` (`npx …`) — the image's `CMD` runs `node server/index.js`.

- [ ] **Step 3: Update `studio-configmap.yaml`**

Replace its `data:` block with:

```yaml
data:
  HOST: "0.0.0.0"
  PORT: "3000"
  OPENCLAW_GATEWAY_URL: ws://openclaw-gateway:18789
  OPENCLAW_STATE_DIR: /home/node/.openclaw
  OPENCLAW_SKIP_NATIVE_RUNTIME_VERIFY: "1"
```

`NEXT_PUBLIC_GATEWAY_URL` is removed (the browser never connects to the Gateway).
`OPENCLAW_SKIP_NATIVE_RUNTIME_VERIFY: "1"` is **kept**: `server/index.js:21,37` runs a
`better-sqlite3` native-ABI verify on every start, and on a detected mismatch it attempts
`npm rebuild` — which would fail in the minimal runtime image. The Docker build already
compiles `better-sqlite3` against the matching `node:20-bookworm-slim` base, so the
runtime re-verify is correctly skipped. `STUDIO_ACCESS_TOKEN` and `OPENCLAW_GATEWAY_TOKEN`
continue to arrive via `openclaw-studio-secrets` (`envFrom`).

- [ ] **Step 4: Delete the per-overlay studio-configmap patches**

```bash
git rm manifests/runtimes/openclaw/overlays/hprd/patches/studio-configmap.yaml
git rm manifests/runtimes/openclaw/overlays/prd/patches/studio-configmap.yaml
```

In **both** `overlays/hprd/kustomization.yaml` and `overlays/prd/kustomization.yaml`, remove this line from the `patches:` list:

```yaml
  - path: patches/studio-configmap.yaml
```

(The Gateway URL is now the same internal value in every environment, so no per-env patch is needed.)

- [ ] **Step 5: Pin the image tag in both overlays**

In **both** overlays' `kustomization.yaml`, replace the `node` entry in the `images:` block with:

```yaml
  - name: systemease/openclaw-studio
    newName: systemease/openclaw-studio
    newTag: 0.1.0-local
```

(Use the exact tag pushed in Task 5 Step 4. Remove the old `- name: node …` entry.)

- [ ] **Step 6: Render both overlays to verify**

Run:
```bash
kubectl kustomize manifests/runtimes/openclaw/overlays/hprd >/dev/null && echo hprd-OK
kubectl kustomize manifests/runtimes/openclaw/overlays/prd >/dev/null && echo prd-OK
```
Expected: prints `hprd-OK` and `prd-OK` with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A manifests/runtimes/openclaw
git commit -m "feat: deploy openclaw-studio from pinned image"
```

> **Image pull note:** if the GHCR package is private, the cluster needs an
> `imagePullSecret`. Either make the package public (recommended for this prototype) or
> add a `dockerconfigjson` Secret to the `prd-openclaw`/`hprd-openclaw` namespaces and an
> `imagePullSecrets:` entry on the Studio pod spec. This is an ops decision; the plan
> assumes a public package.

---

## Task 7: Remove the Gateway public ingress (`agents-platform`)

**Files:**
- Delete: `manifests/runtimes/openclaw/base/gateway-ingress.yaml`
- Delete: `manifests/runtimes/openclaw/overlays/hprd/patches/gateway-ingress.yaml`
- Delete: `manifests/runtimes/openclaw/overlays/prd/patches/gateway-ingress.yaml`
- Modify: `manifests/runtimes/openclaw/base/kustomization.yaml`
- Modify: both overlays' `kustomization.yaml`

- [ ] **Step 1: Delete the ingress manifests**

```bash
git rm manifests/runtimes/openclaw/base/gateway-ingress.yaml
git rm manifests/runtimes/openclaw/overlays/hprd/patches/gateway-ingress.yaml
git rm manifests/runtimes/openclaw/overlays/prd/patches/gateway-ingress.yaml
```

- [ ] **Step 2: Remove the references**

In `manifests/runtimes/openclaw/base/kustomization.yaml`, remove this line from `resources:`:

```yaml
  - gateway-ingress.yaml
```

In **both** overlays' `kustomization.yaml`, remove this line from `patches:`:

```yaml
  - path: patches/gateway-ingress.yaml
```

- [ ] **Step 3: Render both overlays to verify**

Run:
```bash
kubectl kustomize manifests/runtimes/openclaw/overlays/prd | grep -c "kind: Ingress"
```
Expected: prints `1` — only the Studio ingress remains; the Gateway ingress is gone.

- [ ] **Step 4: Commit**

```bash
git add -A manifests/runtimes/openclaw
git commit -m "feat: make openclaw gateway cluster-internal (remove public ingress)"
```

---

## Task 8: Disable Gateway auth (`agents-platform`)

**Files:**
- Modify: `manifests/runtimes/openclaw/base/gateway-bootstrap-configmap.yaml`
- Modify: `manifests/runtimes/openclaw/base/gateway-deployment.yaml`
- Delete: `manifests/runtimes/openclaw/overlays/hprd/patches/gateway-bootstrap-configmap.yaml`
- Delete: `manifests/runtimes/openclaw/overlays/prd/patches/gateway-bootstrap-configmap.yaml`
- Modify: both overlays' `kustomization.yaml`

- [ ] **Step 1: Replace the bootstrap config**

Set the `data:` block of `gateway-bootstrap-configmap.yaml` to exactly:

```yaml
data:
  openclaw.json: |
    {
      "gateway": {
        "mode": "local",
        "auth": { "mode": "none" }
      }
    }
```

`controlUi.allowedOrigins` is removed (the public/browser path is gone).

- [ ] **Step 2: Delete the per-overlay bootstrap patches**

```bash
git rm manifests/runtimes/openclaw/overlays/hprd/patches/gateway-bootstrap-configmap.yaml
git rm manifests/runtimes/openclaw/overlays/prd/patches/gateway-bootstrap-configmap.yaml
```

In **both** overlays' `kustomization.yaml`, remove this line from `patches:`:

```yaml
  - path: patches/gateway-bootstrap-configmap.yaml
```

- [ ] **Step 3: Drop `--auth`/`--token` from the Gateway command**

In `gateway-deployment.yaml`, the `gateway` container's `command:` currently ends with
`--auth token --token $(OPENCLAW_GATEWAY_TOKEN)`. Replace the whole `command:` list with:

```yaml
          command:
            - node
            - dist/index.js
            - gateway
            - run
            - --bind
            - lan
            - --port
            - "18789"
```

- [ ] **Step 4: Replace the bootstrap initContainer**

In `gateway-deployment.yaml`, replace the existing `bootstrap-config` initContainer with
one on the **gateway image** that seeds a fresh PVC and reconciles `auth.mode` on existing
PVCs:

```yaml
      initContainers:
        - name: bootstrap-config
          image: ghcr.io/openclaw/openclaw:latest
          imagePullPolicy: IfNotPresent
          securityContext:
            runAsUser: 0
          command:
            - sh
            - -c
          args:
            - |
              set -eu
              mkdir -p /data/workspace /data/auth-profile-secrets
              if [ ! -f /data/openclaw.json ]; then
                cp /bootstrap/openclaw.json /data/openclaw.json
              fi
              OPENCLAW_CONFIG_PATH=/data/openclaw.json \
                node dist/index.js config set gateway.auth.mode none
              chown -R 1000:1000 /data
          volumeMounts:
            - name: gateway-data
              mountPath: /data
            - name: gateway-bootstrap
              mountPath: /bootstrap
              readOnly: true
```

`securityContext.runAsUser: 0` is required so the `chown` succeeds — the gateway image's
default user is non-root, and files written by `cp`/`config set` must end up owned by
uid 1000 (the user the gateway container runs as, per the pod's `fsGroup: 1000`).

`config set` writes the key atomically and idempotently — fresh PVCs get the full
bootstrap via `cp`; existing PVCs get `gateway.auth.mode` reconciled in place.

- [ ] **Step 5: Render both overlays to verify**

Run:
```bash
kubectl kustomize manifests/runtimes/openclaw/overlays/prd | grep -A3 '"auth"'
```
Expected: shows `"auth": { "mode": "none" }` in the rendered bootstrap ConfigMap.

- [ ] **Step 6: Commit**

```bash
git add -A manifests/runtimes/openclaw
git commit -m "feat: disable openclaw gateway auth (internal-only deployment)"
```

---

## Task 9: Documentation updates (`agents-platform`)

**Files:**
- Modify: `docs/v1/openclaw-system-contract.md`
- Modify: `docs/v1/technical-debt-register.md`
- Modify: `catalog/runtimes/openclaw.yaml`
- Modify: `instances/hprd/openclaw.yaml`, `instances/prd/openclaw.yaml`

- [ ] **Step 1: Update `docs/v1/openclaw-system-contract.md`**

In the "Public Endpoint Contract" section, replace the two-public-endpoint description
with: the Gateway is a **cluster-internal `ClusterIP` service** (`openclaw-gateway:18789`)
with no public ingress and `gateway.auth.mode: none`; **OpenClaw Studio is the sole public
surface** (`https://openclaw.airexpert.cloud`), and it reaches the Gateway server-side
over the internal network. Remove `openclaw-gateway.airexpert.cloud` and
`hprd-openclaw-gateway.airexpert.cloud` from the required-DNS list.

- [ ] **Step 2: Update `docs/v1/technical-debt-register.md`**

Append two entries:
- `gateway.auth.mode=none` — accepted single-tenant compromise; the Gateway is
  unreachable outside the cluster and Studio's access gate is the real boundary.
  Revisit when multi-tenant SaaS work begins.
- Gateway log error `Requested agent harness "codex" is not registered` — pre-existing,
  unrelated to Studio connectivity; tracked for a separate fix.

- [ ] **Step 3: Update `catalog/runtimes/openclaw.yaml`**

`technical_ref.public_entrypoint` already points at the `studio` component — leave it.
Update the `notes:` list: state that the Gateway has **no public endpoint** (it is a
cluster-internal `ClusterIP` service with `auth.mode: none`) and that OpenClaw Studio is
the sole public surface. The `gateway` component entry keeps its service `ports` (the
internal service still exposes them).

- [ ] **Step 4: Update the RuntimeInstance files**

In `instances/hprd/openclaw.yaml` and `instances/prd/openclaw.yaml`: change the `studio`
component `image` to `repository: systemease/openclaw-studio`, `tag: 0.1.0-local`;
remove the `gateway` component's `ingress:` block; remove the gateway `secrets` /
`OPENCLAW_GATEWAY_TOKEN` requirement note for the gateway component (auth is now `none`).
Keep the `studio` component's `secrets` (`STUDIO_ACCESS_TOKEN`, `OPENCLAW_GATEWAY_TOKEN`).

- [ ] **Step 5: Commit**

```bash
git add -A docs catalog instances
git commit -m "docs: openclaw gateway is internal-only; studio is the public surface"
```

---

## Task 10: Deploy and verify (manual, single-tenant)

No code changes — this is the acceptance gate. Both branches must be merged to their
repos' `main` first (the `agents-platform` Runtime deploy workflow deploys from `main`).

- [ ] **Step 1: Merge and deploy**

Merge `feat/v4-protocol` (fork) and `feat/openclaw-studio-v4` (`agents-platform`). Confirm
the image tag in the overlays matches a tag present in GHCR. Trigger the `agents-platform`
**Runtime deploy** workflow: environment `prd`, runtime `openclaw`, mode `apply`.

- [ ] **Step 2: Verify the Gateway is internal and unauthenticated**

Run:
```bash
kubectl get ingress -n prd-openclaw
kubectl logs -n prd-openclaw deploy/openclaw-gateway --tail=30
```
Expected: only `openclaw-studio` ingress exists; Gateway log shows `ready` with no auth
errors.

- [ ] **Step 3: Verify Studio connects**

Run: `kubectl logs -n prd-openclaw deploy/openclaw-studio --tail=40`
Expected: no `protocol mismatch`; the control-plane status reaches `connected`. In the
browser, open `https://openclaw.airexpert.cloud/?access_token=<STUDIO_ACCESS_TOKEN>` —
Studio loads **connected**, with no gateway-token prompt and no device-pairing prompt.

- [ ] **Step 4: Exercise Studio features**

In the UI: send a chat message and confirm a reply renders; list agents; open a session;
view approvals; view cron. If anything is broken by an undocumented v3→v4 change, fix it
as a follow-up task (scope was minimal — `message` cumulative snapshots should suffice).

- [ ] **Step 5: Confirm the access gate**

With `STUDIO_ACCESS_TOKEN` set, opening `https://openclaw.airexpert.cloud/` *without* the
`?access_token=` query should leave `/api/*` calls returning `401` until the cookie is
set. Confirm the gate is active.

---

## Self-Review

**Spec coverage:**
- Spec F1 → Task 1. F2 → Task 3. F3 → Tasks 1–3 (new connect-frame test, mock updates, env test). F4 → Tasks 4–5.
- Spec A1 → Task 6. A2 → Tasks 7–8. A3 → Task 9.
- Spec §8 verification → Task 10.
- All spec sections map to a task.

**Placeholder scan:** No TBD/TODO; every code and YAML step shows complete content; commands have expected output.

**Type consistency:** `loadEnvGatewayDefaults` returns `{ url: string; token: string } | null`, matching `loadLocalGatewayDefaults` and consumed by `resolveGatewayDefaults`. `CONNECT_PROTOCOL` is a single number constant. Image name `systemease/openclaw-studio` and tag `0.1.0-local` are consistent across Tasks 5, 6, and 9.
