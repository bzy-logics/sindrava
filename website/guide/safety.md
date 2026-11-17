# Safety behaviour

::: danger
The on-screen **E-STOP** is a software stop. It travels browser → ratavyr → engine → MCU, and any of those can fail. Every machine must have an independent hardware E-stop circuit that removes driver power.
:::

## E-STOP

- In the header on **every screen**, and **never disabled** — not even while disconnected or signed in as a viewer.
- After a click it shows *"Accepted, waiting for engine confirmation…"*.
- It reports **confirmed** only once engine telemetry says `emergency_stopped`. A successful HTTP response only means the engine accepted the command.
- If the request fails, or no confirmation arrives within **2 s**, it tells the operator to use the hardware emergency stop.
- It is labelled as a software stop.

![Header after pressing E-STOP: emergency stopped, and 'E-STOP confirmed by engine' under the button](/screenshots/estop-confirmed-header.png)

After the engine confirms, the Motion screen shows the latched fault; axes are no longer homed and motion stays disabled until **Reset fault**:

![Motion screen after a confirmed E-STOP, with the emergency_stop fault and Reset Fault button](/screenshots/estop-confirmed.png)

## Confirmations

| Action | Why it asks |
|---|---|
| **Enable** | Energises the drives |
| **Home** | Moves the axis toward its endstop |
| **Home all** | Moves every homeable axis; lists the steps (axes of a step move together) and the start pose to check |
| **Reset fault** | Clears a latched fault (motion does not resume, axes must be re-homed) |
| **Flash** | Requires ticking "drives are powered off" |

In every dialog, **Cancel has the focus**, so pressing Enter or Escape never confirms by accident.

![Confirmation dialog before enabling drives, with Cancel focused](/screenshots/confirm-enable.png)

## Connection status

The header always shows how fresh the data is:

| Status | Meaning |
|---|---|
| `live` | WebSocket connected, telemetry fresh |
| `reconnecting` | API WebSocket down; retrying with exponential backoff (0.5 s → 10 s, ±20 % jitter) |
| `disconnected` | API or engine unreachable, with the engine's reason — e.g. an incompatible API version |
| `stale` | No telemetry for **1.5 s** |
| `faulted` | The robot has a latched fault |

**Motion controls are disabled unless the data is live and fresh.** You can't command a robot you can't currently see.

![Engine disconnected: banner says values are stale, every motion control is disabled, E-STOP stays available](/screenshots/engine-disconnected.png)

## Never synthesised

Every value on screen comes from engine telemetry or configuration. The UI does not predict positions, assume a command succeeded, or fill gaps when data stops. Robot states and faults are explained in [MotionCore: robot states](https://motioncore.bzy-logics.com/guide/robot-states) and [faults](https://motioncore.bzy-logics.com/reference/errors#robot-faults).

## Tested

The E-stop flow, confirmations and permission handling are covered by jsdom UI tests (`npm test`). See [Testing](/development/testing).
