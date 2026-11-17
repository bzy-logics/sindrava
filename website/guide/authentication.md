# Signing in & roles

If ratavyr has API tokens configured, every endpoint except `GET /api/health` and `GET /api/info` needs one. The UI learns this from `/api/info` (`auth_required`) and your role from `/api/session`.

## Entering a token

Enter the token in the banner that appears, or under **Settings**.

![Sign-in banner: the server requires an API token](/screenshots/auth-required.png)

| Option | Stored in | Lifetime |
|---|---|---|
| default | `sessionStorage` | Forgotten when the tab closes |
| **remember on this device** | `localStorage` | Kept until you clear it |

Both use the key `motioncore.api_token`. Only tick "remember" on a device you trust.

## How the token is used

- REST requests send `Authorization: Bearer <token>`.
- Before every WebSocket connect and reconnect, the UI exchanges the token for a **single-use, 30-second ticket** (`POST /api/ws-tickets`) and connects with `?ticket=…`. The token never appears in a URL.

## Roles

| Role | Can |
|---|---|
| viewer | Watch everything; **Stop** and **E-STOP** |
| operator | Everything a viewer can, plus Enable / Disable, Reset fault, jog, home, move, firmware builds |
| admin | Everything, including flashing firmware |

![Motion screen as a viewer: role shown in the header, only Stop and E-STOP are available](/screenshots/role-viewer.png)

Controls your role may not use are disabled with an explanation. The server enforces the same rules regardless of what the UI shows. Tokens and roles are configured on the gateway: [ratavyr: authentication](https://ratavyr.bzy-logics.com/guide/authentication).

## Errors

Your role and how the token is stored are shown under **Settings**:

![Settings: token stored for this tab, role operator](/screenshots/settings.png)

- Any **401** response brings back the sign-in banner.
- A **403** is shown as a failed action.

## Older servers

With ratavyr older than 0.3 (no `/api/session` or `/api/ws-tickets`), the UI still works: your permissions are unknown, so controls stay enabled and the server decides, and the WebSocket falls back to the deprecated `?access_token=`.
