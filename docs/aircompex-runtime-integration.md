# AirCompEx Runtime Integration

This document records the AirCompEx-specific runtime integration contract for this fork.

The fork must remain close to upstream OpenClaw Studio, but it also has to run as a managed runtime UI behind `agent-platform-app`.

## Current Integration State

As of 2026-06-24:

- upstream `grp06/openclaw-studio` changes have been merged into the AirCompEx fork,
- the deployed AirCompEx image is `systemease/openclaw-studio:9f66e73`,
- `agents-platform` deploys this image inside the OpenClaw runtime Pod,
- `agent-platform-app` exposes Studio through the central runtime gateway:

```text
https://agent-platform.airexpert.cloud/runtimes/<runtime-instance-id>/
```

Studio still connects to Gateway server-side over loopback:

```text
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
```

## Managed Base Path

Managed app-driven runtimes must set:

```text
STUDIO_BASE_PATH=/runtimes/<runtime-instance-id>
```

Studio uses this value for browser-facing behavior:

- login and OAuth callback routing,
- sign-out routing,
- generated links,
- settings navigation,
- client-side route transitions that must stay inside the platform runtime gateway path.

This is not a cosmetic URL change. It is required so the browser never falls back to unprefixed Studio routes such as `/auth/callback`, `/settings`, or raw `_next` paths outside the authorized gateway context.

## Repository Boundaries

This repository owns:

- OpenClaw Studio runtime UI compatibility,
- server-side connection to OpenClaw Gateway,
- Studio authentication surface,
- `STUDIO_BASE_PATH` runtime UI behavior.

This repository does not own:

- workspace membership,
- product authorization,
- billing and plans,
- runtime provisioning,
- Kubernetes desired state.

Those responsibilities belong to `agent-platform-app` and `agents-platform`.

## Operational Contract

`agents-platform` must inject `STUDIO_BASE_PATH` per app-driven runtime instance.

`agent-platform-app` must authorize the user before proxying to the internal Studio service.

When Studio runs under `STUDIO_BASE_PATH`, the Advanced "Open Full Control UI"
link must also stay under the platform runtime gateway:

```text
/runtimes/<runtime-instance-id>/control/
```

It must not send the browser to the internal Gateway loopback URL such as
`http://127.0.0.1:18789/`. That loopback address is only valid inside the
runtime Pod.

Studio owns the managed `/control/*` proxy route. In managed mode, the request
flow is:

```text
browser
  -> agent-platform-app /runtimes/<runtime-instance-id>/control/*
  -> Studio /control/*
  -> http://127.0.0.1:18789/*
```

This keeps the Control UI available for authorized platform users without
exposing the Gateway Control UI as a direct Kubernetes Service port.

`agent-platform-app` may also call Studio intent APIs from its provisioning worker to bootstrap
an OpenClaw runtime after Kubernetes and ArgoCD report the runtime ready. This internal path is
limited to `/api/intents/*` and requires a bearer token. The token comes from the same runtime
secret as `OPENCLAW_GATEWAY_TOKEN`, or from `STUDIO_INTERNAL_API_TOKEN` if that explicit value is
provided.

This internal worker path exists so bootstrap templates can create agents and write allowlisted
OpenClaw files through Studio/Gateway domain operations. It must not be expanded into a broad
unauthenticated API bypass.

The Studio image must keep working both ways:

- standalone at `/` for local/upstream-like usage,
- managed under `/runtimes/<runtime-instance-id>/` for AirCompEx platform runtimes.

## Validation

Before promoting a new Studio image for managed platform use, validate:

- `npm run build` or equivalent Next.js build,
- TypeScript checks,
- base-path unit tests,
- login and Google OAuth through the platform gateway,
- settings button navigation under `/runtimes/<runtime-instance-id>/`,
- Advanced Control UI navigation under `/runtimes/<runtime-instance-id>/control/`,
- worker bearer access to `/api/intents/agent-create` and `/api/intents/agent-file-set`,
- no bearer bypass for non-intent APIs such as `/api/runtime/*`,
- direct unprefixed settings navigation does not break the managed route.
