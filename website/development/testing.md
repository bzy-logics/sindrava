# Testing

## Checks

```sh
npm run typecheck
npm test           # vitest: unit tests and jsdom UI tests
npm run build
```

The jsdom UI tests cover the safety-relevant behaviour: the E-stop flow and its confirmation, confirmation dialogs, and permission handling. Unit tests cover the REST and WebSocket clients, token storage and derived status.

## End-to-end

Against a running stack — ratavyr plus the engine with its virtual MCU and `robot-profiles/single-axis-virtual.toml` — using the app's own REST and WebSocket clients:

```sh
MOTIONCORE_E2E_URL=http://127.0.0.1:8080 \
MOTIONCORE_E2E_OPERATOR_TOKEN=... \
MOTIONCORE_E2E_VIEWER_TOKEN=... \
  npx vitest run src/e2e
```

ratavyr must be started with the same operator and viewer tokens. See [ratavyr: getting started](https://ratavyr.bzy-logics.com/guide/getting-started) and [motioncore: quick start](https://motioncore.bzy-logics.com/guide/quick-start).

## CI

[`.github/workflows/ci.yml`](https://github.com/bzy-logics/sindrava/blob/main/.github/workflows/ci.yml) runs typecheck, tests and build, and the end-to-end test against freshly built motioncore and ratavyr (checked out from `bzy-logics`).

[`.github/workflows/docs.yml`](https://github.com/bzy-logics/sindrava/blob/main/.github/workflows/docs.yml) builds this documentation site and deploys it to GitHub Pages.
