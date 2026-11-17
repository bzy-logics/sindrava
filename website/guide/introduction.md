# Introduction

sindrava is the browser operator UI for [MotionCore](https://motioncore.bzy-logics.com). It is built with Vite, React 19, strict TypeScript, plain Three.js and plain CSS.

```text
browser: sindrava ──REST / WebSocket──▶ ratavyr ──gRPC──▶ motioncore engine ──▶ MCU
```

![sindrava's 3D viewer showing a two-link arm on a linear rail](/screenshots/viewer.png)

MotionCore is split into three repositories:

| Repository | Role | Docs |
|---|---|---|
| motioncore | Rust motion engine — the state authority — plus firmware and CLI | [motioncore.bzy-logics.com](https://motioncore.bzy-logics.com) |
| ratavyr | Go REST/WebSocket gateway in front of the engine | [ratavyr.bzy-logics.com](https://ratavyr.bzy-logics.com) |
| sindrava | This UI | this site |

## A replaceable client

sindrava talks **only** to ratavyr's public HTTP API. It:

- holds no robot logic of its own;
- never synthesises robot state — everything shown comes from engine telemetry;
- treats its own button enablement as a convenience only: every command is validated by the server and the engine.

Any other HTTP client — scripts, HMI panels, a different frontend — can use the same [REST API](https://ratavyr.bzy-logics.com/reference/rest-api).

## What you can do with it

- See robot state, faults, MCU health and every axis at a glance.
- Enable and disable drives, home, jog and move axes, stop, and E-stop.
- See commanded vs. measured pose in 3D — as one connected robot when the profile describes its geometry.
- Inspect the robot configuration and its device graph.
- Build firmware and, as an admin, flash it.
- Inspect plugins, the MCU link, queue fill, position history and the log.

See [Screens](/guide/screens).

::: danger
The on-screen **E-STOP** is a software stop. It is not a substitute for an independent hardware E-stop circuit that removes driver power.
:::
