# Getting started

## Requirements

- Node.js and npm.
- A running [ratavyr](https://ratavyr.bzy-logics.com/guide/getting-started), connected to a MotionCore engine. For development, the engine with its virtual MCU is enough — no hardware.

## Development

Start the engine and ratavyr (on `127.0.0.1:8080`), then:

```sh
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` — REST and the `/api/ws` WebSocket upgrade — to `http://127.0.0.1:8080`, so the browser talks to a single origin, exactly as in production. ratavyr already allows `localhost:5173` and `127.0.0.1:5173` as browser origins by default.

The whole stack, from scratch:

```sh
# terminal 1 — engine (motioncore checkout)
cargo build && target/debug/motioncore start --config robot-profiles/single-axis-virtual.toml

# terminal 2 — gateway (ratavyr checkout)
go run ./cmd/server

# terminal 3 — UI (this repo)
npm install && npm run dev
```

Open `http://localhost:5173`. The header should show **live**.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server on port 5173 with the `/api` proxy |
| `npm run typecheck` | `tsc` only |
| `npm test` | Vitest: unit tests and jsdom UI tests |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run preview` | Serve `dist/` locally |

## Production

Build, and let ratavyr serve `dist/`:

```sh
npm run build
# on the server:
MOTIONCORE_WEB_DIR=/path/to/sindrava/dist ./ratavyr
```

ratavyr serves the directory at `/` with SPA fallback and security headers, so the UI and API share one origin.

Any other static host works too, as long as `/api` — **including the WebSocket upgrade on `/api/ws`** — is reverse-proxied to ratavyr on the same origin. If the UI is served from a different origin than ratavyr sees, add it to `MOTIONCORE_ALLOWED_ORIGINS`.

There is no runtime configuration: the UI always talks to `/api` on its own origin. Securing the deployment (tokens, TLS) is done on the gateway; see [ratavyr: deployment](https://ratavyr.bzy-logics.com/guide/deployment).
