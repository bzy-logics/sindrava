import { useState } from "react";
import { useEngine, usePermissions, useTelemetry } from "../../hooks/useEngine";
import { useCommand } from "../../hooks/useCommand";
import { fmt } from "../../components/common";
import { allowed } from "./axes";
import { SPEEDS, type JointTargets } from "./jointMove";

/** Most waypoints the engine accepts in one path. */
export const MAX_WAYPOINTS = 256;

/**
 * Blended joint path (MoveJPath, engine-api >= 0.3), taught by example: move
 * the robot to a pose (jog, Joint move, 3D viewer), press "Add current pose",
 * repeat, then "Run path". The robot moves through the waypoints in order
 * without stopping at the intermediate ones; corners are rounded.
 */
export function PathPanel() {
  const s = useEngine();
  const run = useCommand();
  const perms = usePermissions();
  const { telemetry: t, online, state } = useTelemetry();
  const [waypoints, setWaypoints] = useState<JointTargets[]>([]);
  const [speed, setSpeed] = useState<number>(0.5);
  const ids = (s.config?.axes ?? []).map((a) => a.id);

  const add = () => {
    if (!t) return;
    const pose = Object.fromEntries(t.axes.map((a) => [a.id, Number(a.commanded_position.toFixed(3))]));
    setWaypoints((w) => (w.length >= MAX_WAYPOINTS ? w : [...w, pose]));
  };
  const remove = (i: number) => setWaypoints((w) => w.filter((_, k) => k !== i));
  const used = new Set(waypoints.flatMap((w) => Object.keys(w)));
  const unhomed = [...used].filter((id) => !t?.axes.find((a) => a.id === id)?.homed);

  let why: string | null = null;
  if (waypoints.length === 0) why = "Add at least one waypoint.";
  else if (!online) why = "Live data required.";
  else if (!perms.command) why = "Requires the operator role.";
  else if (unhomed.length > 0) why = `Home ${unhomed.join(", ")} first.`;
  else if (!allowed.move_j_path(state)) why = `Robot is ${state.replace("_", " ")}; it must be ready.`;

  const start = async () => {
    if (why !== null) return;
    await run("move_j_path", { waypoints, ...(speed < 1 ? { speed_scale: speed } : {}) });
  };

  return (
    <section className="panel movej-panel" aria-label="Joint path">
      <div className="panel-head">
        <h2>Joint path</h2>
        <span className="muted small">Through every waypoint without stopping; corners are rounded.</span>
      </div>
      {waypoints.length === 0 ? (
        <p className="small muted">Move the robot to a pose, then add it as a waypoint. The path starts from wherever the robot is when you run it.</p>
      ) : (
        <div className="table-wrap">
          <table className="table small mono path-table">
            <thead>
              <tr>
                <th>#</th>
                {ids.map((id) => (
                  <th key={id}>{id}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {waypoints.map((w, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {ids.map((id) => (
                    <td key={id}>{w[id] === undefined ? "—" : fmt(w[id])}</td>
                  ))}
                  <td>
                    <button className="btn btn-small" onClick={() => remove(i)} aria-label={`Remove waypoint ${i + 1}`}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="btn-row">
        <button className="btn" onClick={add} disabled={!t || waypoints.length >= MAX_WAYPOINTS}>
          Add current pose
        </button>
        <div className="seg" role="radiogroup" aria-label="Path speed">
          {SPEEDS.map((v) => (
            <button key={v} role="radio" aria-checked={speed === v} className={`seg-btn ${speed === v ? "active" : ""}`} onClick={() => setSpeed(v)}>
              {v * 100}%
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={why !== null} onClick={() => void start()}>
          Run path ({waypoints.length} {waypoints.length === 1 ? "waypoint" : "waypoints"})
        </button>
        <button className="btn" onClick={() => setWaypoints([])} disabled={waypoints.length === 0}>
          Clear
        </button>
      </div>
      {waypoints.length > 0 && why && <div className="small warn-text">{why}</div>}
    </section>
  );
}
