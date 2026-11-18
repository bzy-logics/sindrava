# API client

## The contract

The contract is **ratavyr's REST API v1**, specified in [`ratavyr/docs/rest-api.md`](https://github.com/bzy-logics/ratavyr/blob/main/docs/rest-api.md) and documented at [ratavyr.bzy-logics.com](https://ratavyr.bzy-logics.com/reference/rest-api).

- `src/types/api.ts` mirrors it **type-for-type**.
- `src/api/` implements it.

When the contract changes, **update `src/types/api.ts` first**. `npm run typecheck` then shows every place that needs attention.

## `src/api/`

| File | Responsibility |
|---|---|
| `client.ts` | Typed REST client for `/health`, `/info`, `/session`, `/status`, `/config`, `/plugins`, `/commands/{name}`, `/ws-tickets`, `/firmware/*`. Parses the error envelope `{"error":{"code","message"}}` into `ApiError` |
| `ws.ts` | `/api/ws` client for `engine`, `telemetry` and `log` messages. Fetches a fresh single-use ticket before every connect; reconnects with backoff |
| `backoff.ts` | Exponential backoff with jitter: 500 ms doubling to 10 s, ±20 % |
| `auth.ts` | Token storage: `sessionStorage` by default, `localStorage` when remembered (key `motioncore.api_token`) |
| `index.ts` | Public exports, including the API types |

```ts
import { api, ApiError } from './api'

try {
  await api.command('jog', { axis: 'j1', delta: 5 })   // params are typed per command name
  const jobs = await api.firmware.jobs()
} catch (e) {
  if (e instanceof ApiError && e.code === 'not_homed') { /* … */ }
}
```

`ApiError` carries `code`, `message` and the HTTP `status`. A response without the error envelope becomes code `http_<status>`. Branch on `code`, never on the message. The codes are listed in [ratavyr: error codes](https://ratavyr.bzy-logics.com/reference/errors).

## `src/hooks/`

| Hook / module | Responsibility |
|---|---|
| `liveStore.ts` | One shared live store: engine connection, latest telemetry, a 30 s position history, the last 500 log lines, and a health poll every 5 s |
| `useEngine` / `useTelemetry` / `useAuth` | React access to the live store |
| `status.ts` | Derived status: `stale` after 1.5 s without telemetry, E-stop confirmation window (2 s), permissions from `/api/session` |
| `usePolling` | Fetches on mount and then at an interval, with `data` / `error` / `loading` / `refresh`; for data not on the event stream (e.g. firmware jobs) |
| `useCommand` | Sends a command; failures surface as toasts ("Jog failed: not_homed"); resolves `true` on success |

## Rules the client follows

- **Never synthesise robot state.** Display only what telemetry and configuration report.
- **A command response is acceptance, not completion.** Wait for telemetry.
- **Tolerate unknown enum values.** A newer engine with the same `0.MINOR` may send `"unknown"`, and `"unspecified"` is possible.
- **Treat nulls as "not set".** Optional fields are always present, as `null` when unset.
- **Detect features by fields, not versions.** A capability the engine reports in a field is detected by that field: the Cartesian move panel appears only while telemetry carries a `tool` pose (MoveL exists then, and only for serial-chain robots); Home all follows `config.home_all`; collision warnings follow `config.collision_checking`. Commands that arrived with a new engine API minor and have no field are gated on that minor: `move_j` on 0.2, `move_j_path` on 0.3.
- **Permissions are a hint.** If `/api/session` is unavailable (ratavyr < 0.3), all permissions are treated as unknown/allowed and the server decides.

## Compatibility with older servers

| Server | Behaviour |
|---|---|
| ratavyr ≥ 0.3 | Full: session, roles, WebSocket tickets |
| ratavyr < 0.3 | Works. No `/api/session`, so permissions are unknown; no `/api/ws-tickets`, so the WebSocket falls back to `?access_token=` |
