# Screens

The active tab is kept in the URL hash (`#motion`, `#firmware`, …), so any screen can be bookmarked. The header — with the connection status and the red **E-STOP** — is the same on every screen.

## Overview

Robot name and profile, robot state, the active fault and derived alarms, an MCU health summary, and a summary of every axis.

## Motion

- **Enable / Disable / Stop** and **Reset fault**.
- Per axis: **jog** (relative), **home**, and **absolute move** — absolute only for homed axes.
- **Soft-limit bars** showing commanded vs. measured position within `[min, max]`.

Axes are commanded one at a time: the engine has no coordinated multi-axis moves yet. Enable, Home and Reset fault ask for confirmation first; see [Safety behaviour](/guide/safety). For what each command does, see [MotionCore: moving axes](https://motioncore.bzy-logics.com/guide/motion).

## 3D Viewer

The measured pose drawn solid, the planned (commanded) pose as a ghost. Each axis is shown as its own joint: a revolute arm or a prismatic rail. three.js is loaded lazily as its own chunk, so the viewer costs nothing until you open it.

## Robot

The loaded robot configuration, read-only: MCUs, axes, limits, actuator and pins.

## Composer

The device graph, read-only: Robot → MCU → channel → axis → driver (actuator, step / dir / enable) + endstop. Editing comes later; for now, edit the [robot configuration](https://motioncore.bzy-logics.com/guide/configuration) TOML and restart the engine.

## Firmware

- Supported **targets**.
- **Build firmware** for each configured MCU. Virtual boards are disabled — they need no firmware.
- **Jobs** with state, log and artifact (build hash, SHA-256).
- **Flash** for succeeded builds, behind an explicit "drives are powered off" confirmation. Admin only.

Job progress is polled. Verifying which build is actually running is CLI-only: [`motioncore firmware verify`](https://motioncore.bzy-logics.com/hardware/firmware#verify).

## Plugins

A table of plugins with description, permissions, state and error.

## Diagnostics

- MCU link details: board, firmware version, build hash, capabilities, clock offset, round-trip time, frame and CRC-error counters.
- Queue fill bar.
- 30-second position chart.
- Filtered log.

## Settings

- API token, kept for this tab only or remembered on this device.
- Your role.
- Server and engine versions.
