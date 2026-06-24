# AirCompEx Runtime Integration

This document records the AirCompEx-specific runtime integration contract for this fork.

The fork must remain close to upstream OpenClaw Studio, but it also has to run as a managed runtime UI behind `agent-platform-app`.

## Current Integration State

As of 2026-06-24:

- upstream `grp06/openclaw-studio` changes have been merged into the AirCompEx fork,
- the deployed AirCompEx image is `systemease/openclaw-studio:ab59f9f`,
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
- direct unprefixed settings navigation does not break the managed route.
