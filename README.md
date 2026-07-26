# sindrava

Operator UI for MotionCore. Vite + React 19 + TypeScript (strict) + plain Three.js, plain CSS.

MotionCore is split into three repos:

| repo | role |
|---|---|
| `motioncore` | Rust motion engine — the state authority |
| `ratavyr` | Go REST/WebSocket gateway in front of the engine |
| `sindrava` | this UI |

**This UI is a replaceable client.** It talks only to `ratavyr` over the public
HTTP API, holds no robot logic of its own and never synthesises robot state. Every command
is validated by the server/engine; the UI's button enablement is only a convenience. Any other
HTTP client (scripts, HMI panels, a different frontend) can use the same API.

## API contract

The contract is **`ratavyr/docs/rest-api.md` (v1)**. `src/types/api.ts` mirrors it
type-for-type and `src/api/` implements it:

- `src/api/client.ts` — typed REST client (`/health`, `/info`, `/status`, `/config`, `/plugins`,
  `/commands/{name}`, `/firmware/*`), error envelope parsing (`{"error":{"code","message"}}` → `ApiError`)
- `src/api/ws.ts` — `/api/ws` client (engine/telemetry/log messages) with exponential backoff + jitter
- `src/api/auth.ts` — API token storage

When the contract changes, update `src/types/api.ts` first; `npm run typecheck` then shows every
place that needs attention.

## Run

```sh
npm install
npm run dev        # http://localhost:5173, proxies /api (REST + WebSocket) to http://127.0.0.1:8080
npm run typecheck  # tsc only
npm test           # vitest unit tests (API client, backoff, mapping helpers)
npm run build      # tsc + production build into dist/
npm run preview    # serve dist/ locally
```

**Development:** start `ratavyr` on `127.0.0.1:8080`, then `npm run dev`.

**Production:** `npm run build` and let `ratavyr` serve `dist/` (it serves a web directory at `/`
with SPA fallback), so UI and API share one origin. Any static host works as long as `/api` (including the
WebSocket upgrade on `/api/ws`) is reverse-proxied to the server on the same origin.

## Authentication

If the server is started with `MOTIONCORE_API_TOKEN`, every endpoint except `GET /api/health` and
`GET /api/info` requires a token. `/api/info` reports `auth_required`.

- Enter the token under **Settings** (or in the banner that appears). It is stored in this browser's
  `localStorage` (`motioncore.api_token`).
- REST requests send `Authorization: Bearer <token>`; the WebSocket uses `/api/ws?access_token=<token>`
  (browsers cannot set WS headers).
- Any `401` response shows an auth banner prompting for the token. Saving a token reconnects the stream
  and re-fetches data.

Without a token the server only binds to loopback by default.

## Screens

| Tab | Contents |
|---|---|
| Overview | Robot name/profile, state, active fault + derived alarms, MCU health summary, axis summary |
| Motion | Enable/Disable/Stop, Reset Fault, per-axis jog/home/absolute move (homed axes only), soft-limit bars |
| 3D Viewer | Measured pose solid, planned (commanded) pose as ghost; lazy-loaded (three.js is its own chunk) |
| Robot | Read-only RobotConfig: MCUs, axes, limits, actuator, pins |
| Composer | Read-only device graph Robot → MCU → channel → axis → driver (actuator, step/dir/enable) + endstop. Editing comes later |
| Firmware | Targets, "Build firmware" per configured MCU (virtual boards disabled), jobs with state/log/artifact (build hash, SHA-256), "Flash" for succeeded builds behind an explicit "drives are powered off" confirmation |
| Plugins | Plugin table with description, permissions, state and error |
| Diagnostics | MCU link details (board, build hash, …), queue bar, 30 s position chart, filtered log |
| Settings | API token, server/engine versions |

The active tab is kept in the URL hash (`#firmware`, …). The red **E-STOP** button is in the header on every
screen and is never disabled.

## Layout

```
src/
  app/          shell, navigation, header (E-STOP), connection/auth banners, settings, styles
  components/   shared UI: badges, LEDs, chips, panels, dialog, toasts
  features/     dashboard, motion (control + 3D viewer), robots, composer, firmware, plugins, diagnostics
  api/          REST + WebSocket clients, auth token store, backoff
  hooks/        live store (useEngine / useTelemetry / useAuth), usePolling, useCommand
  types/        API contract types
public/         static assets
```
