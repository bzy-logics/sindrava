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
- **Home all**: homes every axis that has a homing configuration. With engine API 0.1.4 or newer, the engine runs the robot profile's home-all plan: the axes of one step home **at the same time**, and the steps run in order. The confirmation lists the steps and the start pose the plan was designed for: joint positions are unknown until each switch triggers, so no software can check these paths — make sure the robot is in that pose. Progress shows as *Homing j4, j5, j6 (1/2)…* with a **Cancel** button (sends Stop). It stops at the first fault, emergency stop or loss of live data and says where; it keeps running if you switch screens. With older engines, sindrava homes the axes one after the other in profile order, each an ordinary home command.

  ![Home all confirmation: two steps of three axes each, and the start pose to check](/screenshots/home-all-plan.png)
- **Soft-limit bars** showing commanded vs. measured position within `[min, max]`.

![Motion: enable, disable and stop, and a card per axis with jog, home and absolute move](/screenshots/motion.png)

**Joint move** (engine API 0.2 or newer) moves several joints together: type a target for any joints (blank holds the joint; **Fill current** copies the present pose), pick a speed (25, 50 or 100 % of each joint's maximum velocity) and press **Move N joints together**. The engine sends one coordinated move in which every joint starts and finishes at the same time, on a straight line in joint space. The same checks as in the 3D viewer apply (homed joints, soft limits, collision with the engine's model), and the reason is shown before anything is sent.

![Joint move panel with targets for all six joints](/screenshots/movej-panel.png)

**Cartesian move** (engine API 0.3 or newer, robots whose geometry is a single serial chain) shows the live tool pose and moves the tool point in a **straight line** to X, Y, Z (mm, robot base frame). Leave roll/pitch/yaw empty to keep the orientation, or fill them to turn the tool on the way (six-joint robots). **Fill current** copies the present pose; the speed is the tool speed along the line. The engine solves the joint motion and refuses lines that are out of reach, need a joint beyond its limits, pass a singularity or would collide; the reason appears as a toast.

![Cartesian move panel: tool pose, target X/Y/Z and orientation, tool speed](/screenshots/cartesian-panel.png)

**Joint path** (engine API 0.3 or newer) teaches a path by example: move the robot to a pose (jog, Joint move or the 3D viewer), press **Add current pose**, repeat, then **Run path**. The robot moves through the waypoints in order **without stopping** at the intermediate ones; corners are rounded. The path starts from wherever the robot is when you run it. Waypoints are kept in the browser tab only.

![Joint path panel with three taught waypoints](/screenshots/path-panel.png)

Jog and the per-axis Move address one joint. Enable, Home and Reset fault ask for confirmation first; see [Safety behaviour](/guide/safety). For what each command does, see [MotionCore: moving axes](https://motioncore.bzy-logics.com/guide/motion).

## 3D Viewer

The robot in 3D: measured pose drawn solid, planned (commanded) pose as a translucent ghost.

![3D Viewer: a two-link arm mounted on the carriage of a linear rail](/screenshots/viewer.png)

- **Connected robot.** When the robot profile describes how the joints are mounted (`[axis.geometry]`: parent joint, offset, rotation, joint axis — see [MotionCore: configuration](https://motioncore.bzy-logics.com/guide/configuration)), the viewer draws one connected machine: here the arm rides on the rail carriage and each link runs from joint to joint. Needs engine API 0.1.3 or newer.
- **Separate axes.** Without geometry, each axis is drawn on its own — a revolute arm or a prismatic rail — and the legend says why. The viewer never guesses how axes are mounted.
- It works for any serial chain. A simulated six-axis desktop arm (MotionCore's `robot-profiles/dummy-arm-virtual.toml`):

  ![3D Viewer: a six-axis desktop arm in a working pose](/screenshots/dummy-arm-pose.png)

  ![Motion screen with six joint cards for the same arm](/screenshots/dummy-arm-motion.png)

- **Move from the view.** Click a joint (or its row in the legend) to select it: a yellow ring marks it and a panel opens with jog buttons and a target. Drag the selected joint, or use the slider or number field, to **preview** a target — an amber copy of the robot shows the pose. **Nothing is sent while you drag.** Press **Move** to send it; the same rules as the Motion screen apply (operator role, live data, robot ready, axis homed, target within the soft limits, which the drag stops at). Esc deselects.
- **Several joints at once.** Previews are kept per joint: select another joint and preview it too, and the amber robot shows the whole pose (the legend lists every previewed target). **Move N joints together** sends one coordinated joint move at the chosen speed, so every joint starts and finishes at the same time; **Clear all** drops the preview. Needs engine API 0.2 or newer.

  ![Three joints previewed together, with Move 3 joints together](/screenshots/viewer-movej-preview.png)

  ![The same move halfway: every joint is the same fraction of the way](/screenshots/viewer-movej-moving.png)
- **Tool position.** For serial-chain robots the legend shows the tool point (mm), updated live.

  ![A blended joint path running: measured arm, commanded pose and the tool position in the legend](/screenshots/viewer-path.png)
- **Collision warning.** When the profile gives its links a thickness (`radius`), the engine refuses moves that would make the robot collide with itself or reach the floor once all axes are homed. The viewer runs the same check on the preview: a move that would collide turns the preview **red**, names the links and the joint value where they would meet, and disables **Move**. The engine checks again and has the final word.

  ![A wrist preview that would fold into the base: red preview and the collision message](/screenshots/viewer-collision.png)

  ![Dragging the shoulder joint: amber preview pose, joint panel with Move button](/screenshots/viewer-drag.png)

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
