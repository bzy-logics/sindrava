# Screens

The active tab is kept in the URL hash (`#motion`, `#firmware`, …), so any screen can be bookmarked. The header — with the connection status and the red **E-STOP** — is the same on every screen.

::: tip About these screenshots
They are taken from the running stack — sindrava → ratavyr → motioncore engine → virtual MCU — with MotionCore's `robot-profiles/rail-arm-virtual.toml`: a two-link arm carried by a linear rail, signed in as an operator. No hardware involved.
:::

## Overview

Robot name and profile, robot state, the active fault and derived alarms, an MCU health summary, and a summary of every axis.

![Overview: robot, alarms, MCU health and an axis table](/screenshots/overview.png)

## Motion

- **Enable / Disable / Stop** and **Reset fault**.
- Per axis: **jog** (relative), **home**, and **absolute move** — absolute only for homed axes.
- **Soft-limit bars** showing commanded vs. measured position within `[min, max]`.

![Motion: enable, disable and stop, and a card per axis with jog, home and absolute move](/screenshots/motion.png)

Axes are commanded one at a time: the engine has no coordinated multi-axis moves yet. Enable, Home and Reset fault ask for confirmation first; see [Safety behaviour](/guide/safety). For what each command does, see [MotionCore: moving axes](https://motioncore.bzy-logics.com/guide/motion).

## 3D Viewer

The robot in 3D: measured pose drawn solid, planned (commanded) pose as a translucent ghost.

![3D Viewer: a two-link arm mounted on the carriage of a linear rail](/screenshots/viewer.png)

- **Connected robot.** When the robot profile describes how the joints are mounted (`[axis.geometry]`: parent joint, offset, rotation, joint axis — see [MotionCore: configuration](https://motioncore.bzy-logics.com/guide/configuration)), the viewer draws one connected machine: here the arm rides on the rail carriage and each link runs from joint to joint. Needs engine API 1.1 or newer.
- **Separate axes.** Without geometry, each axis is drawn on its own — a revolute arm or a prismatic rail — and the legend says why. The viewer never guesses how axes are mounted.
- Links are schematic cylinders, not CAD meshes. The camera frames the robot when the view opens; drag to orbit, wheel to zoom, right-drag to pan.

three.js is loaded lazily as its own chunk, so the viewer costs nothing until you open it.

## Robot

The loaded robot configuration, read-only: MCUs, axes, limits, actuator and pins.

![Robot: MCU and axis tables with limits, velocities, steps per unit and pins](/screenshots/robot.png)

## Composer

The device graph, read-only: Robot → MCU → channel → axis → driver (actuator, step / dir / enable) + endstop. Editing comes later; for now, edit the [robot configuration](https://motioncore.bzy-logics.com/guide/configuration) TOML and restart the engine.

![Composer: the device graph from robot to MCU, channels, axes, drivers and endstops](/screenshots/composer.png)

## Firmware

- Supported **targets**.
- **Build firmware** for each configured MCU. Virtual boards are disabled — they need no firmware.
- **Jobs** with state, log and artifact (build hash, SHA-256).
- **Flash** for succeeded builds, behind an explicit "drives are powered off" confirmation. Admin only.

![Firmware: build per MCU (disabled for the virtual board), jobs and the list of targets](/screenshots/firmware.png)

Job progress is polled. Verifying which build is actually running is CLI-only: [`motioncore firmware verify`](https://motioncore.bzy-logics.com/hardware/firmware#verify).

## Plugins

A table of plugins with description, permissions, state and error.

![Plugins: table of loaded plugins and their state](/screenshots/plugins.png)

## Diagnostics

- MCU link details: board, firmware version, build hash, capabilities, clock offset, round-trip time, frame and CRC-error counters.
- Queue fill bar.
- 30-second position chart.
- Filtered log.

![Diagnostics during a move: MCU link details, queue filling up and the position chart](/screenshots/diagnostics.png)

## Settings

- API token, kept for this tab only or remembered on this device.
- Your role.
- Server and engine versions.

![Settings: API token, role and server and engine versions](/screenshots/settings.png)
