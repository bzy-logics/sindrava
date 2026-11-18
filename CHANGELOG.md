# Changelog

All notable changes to sindrava, the MotionCore operator UI. Validation levels follow MotionCore's: *implemented*, *simulated* (against the engine's virtual MCU), *software-tested* (automated tests in CI), *hardware-validated*. sindrava holds no robot logic; the engine validates every command (see [MotionCore's changelog](https://github.com/bzy-logics/motioncore/blob/main/CHANGELOG.md)).

## [0.3.0] — 2026-11-19

The first sindrava release, part of the MotionCore v0.3.0 baseline. The version jumps from 0.1.0 so that all three repositories share the baseline number.

### Compatibility

| Component | Version |
|---|---|
| ratavyr | v0.3.0 (REST and WebSocket API v1) |
| MotionCore engine | v0.3.0 (engine-api 0.3.x); features of older engines are detected and hidden |

### Screens — simulated, software-tested (feature and end-to-end tests against the full stack)

- Dashboard and connection status; E-STOP on every screen, reporting success only once telemetry shows `emergency_stopped`.
- Motion: enable, disable, stop, per-axis jog, homing, absolute moves, Home all with the profile's plan, collision warnings.
- Coordinated moves: joint moves, joint paths through several poses, and Cartesian moves of the tool (shown when telemetry carries a tool pose).
- 3D viewer: the robot drawn from the profile's kinematic geometry, measured pose solid and commanded pose as a ghost; joints can be moved from the viewer.
- Robot configuration and device composer, plugins, firmware jobs and diagnostics views.
- Roles from the server: controls a role may not use are hidden; the server enforces them regardless.

### Known limitations

- No pause and resume, position confidence display or path-preservation feedback yet (#14).
- No execution monitoring (#8) or alarm history (#9).

[0.3.0]: https://github.com/bzy-logics/sindrava/releases/tag/v0.3.0
