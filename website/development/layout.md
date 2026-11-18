# Code layout & limitations

## Layout

```text
src/
  app/          shell, navigation, header (E-STOP), connection/auth banners, settings, styles
  components/   shared UI: badges, LEDs, chips, panels, dialog, toasts
  features/     dashboard, motion (control + 3D viewer), robots, composer, firmware, plugins, diagnostics
  api/          REST + WebSocket clients, auth token store, backoff
  hooks/        live store (useEngine / useTelemetry / useAuth), usePolling, useCommand
  types/        API contract types (mirror of ratavyr's REST API)
  e2e/          end-to-end tests against a running stack
public/         static assets
website/        this documentation site
```

Stack: Vite, React 19, TypeScript (strict), plain Three.js, plain CSS. No UI framework or state library.

## Known limitations

These mostly need new engine functionality first:

- **Robot Composer is read-only.** The engine has no configuration editing or validation API; robot profiles are TOML files loaded when the engine starts.
- **3D viewer** shows each axis as its own joint (revolute arm or prismatic rail). An articulated kinematic chain needs link geometry the engine does not expose yet.
- **Joint-space moves only** and no planned-trajectory preview: `move_j` moves several joints together, but there are no Cartesian moves. Commanded vs. measured position is shown per axis.
- **Firmware verify** (running build vs. artifact) is CLI-only in the engine.
- **One MCU per robot** in telemetry (engine-api v1).
