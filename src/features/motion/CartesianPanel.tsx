import { useState, type FormEvent } from "react";
import { useEngine, usePermissions, useTelemetry } from "../../hooks/useEngine";
import { useCommand } from "../../hooks/useCommand";
import { fmt } from "../../components/common";
import { allowed } from "./axes";

const POS = ["x", "y", "z"] as const;
const ROT = ["roll", "pitch", "yaw"] as const;
const SPEEDS_MM_S = [10, 25, 50, 100] as const;

type Vec = [number, number, number];

/** Why a Cartesian move cannot be sent, or null when it can. */
export function cartesianBlocker(m: {
  online: boolean;
  canCommand: boolean;
  allHomed: boolean;
  state: Parameters<typeof allowed.move_l>[0];
  position: (number | null)[];
  rotation: (number | null)[] | null;
}): string | null {
  if (!m.online) return "Live data required.";
  if (!m.canCommand) return "Requires the operator role.";
  if (!m.allHomed) return "Home every axis first: a Cartesian move needs the whole pose.";
  if (m.position.some((v) => v === null)) return "Enter X, Y and Z.";
  if (m.rotation && m.rotation.some((v) => v === null)) return "Enter roll, pitch and yaw, or clear all three to keep the orientation.";
  if (!allowed.move_l(m.state)) return `Robot is ${m.state.replace("_", " ")}; it must be ready.`;
  return null;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

/**
 * Cartesian straight-line move (MoveL): the tool point of a serial-chain robot
 * moves in a straight line to X, Y, Z (mm, robot base frame); the orientation
 * is held unless roll/pitch/yaw are given. Shown only while telemetry carries
 * a tool pose: the engine reports one exactly when MoveL is available
 * (engine-api >= 0.3 and a serial-chain geometry), so no version check. The engine
 * solves the joint motion, checks reach, joint limits, singularities and
 * collisions, and refuses the move otherwise.
 */
export function CartesianPanel() {
  const s = useEngine();
  const run = useCommand();
  const perms = usePermissions();
  const { telemetry: t, online, state } = useTelemetry();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [speed, setSpeed] = useState<number>(50);
  const tool = t?.tool ?? null;
  const orient = (s.config?.axes.length ?? 0) >= 6;

  const position = POS.map((k) => num(draft[k]));
  const rotRaw = ROT.map((k) => draft[k]);
  const rotation = orient && rotRaw.some((v) => v !== undefined && v.trim() !== "") ? ROT.map((k) => num(draft[k])) : null;
  const allHomed = !!t && t.axes.every((a) => a.homed);
  const why = cartesianBlocker({ online, canCommand: perms.command, allHomed, state, position, rotation });

  const fill = () => {
    if (!tool) return;
    const r = (v: number) => String(Number(v.toFixed(2)));
    setDraft({
      x: r(tool.position_mm[0]),
      y: r(tool.position_mm[1]),
      z: r(tool.position_mm[2]),
      ...(orient ? { roll: r(tool.rotation_deg[0]), pitch: r(tool.rotation_deg[1]), yaw: r(tool.rotation_deg[2]) } : {}),
    });
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (why !== null) return;
    const params = {
      position_mm: position as Vec,
      ...(rotation ? { rotation_deg: rotation as Vec } : {}),
      speed_mm_s: speed,
    };
    await run("move_l", params);
  };

  if (!tool) return null;
  return (
    <section className="panel movej-panel" aria-label="Cartesian move">
      <div className="panel-head">
        <h2>Cartesian move</h2>
        <span className="muted small">The tool point moves in a straight line.</span>
      </div>
      <div className="small mono tool-pose" aria-label="Tool pose">
        tool x {fmt(tool.position_mm[0])} y {fmt(tool.position_mm[1])} z {fmt(tool.position_mm[2])} mm
        {orient && (
          <>
            {" · "}roll {fmt(tool.rotation_deg[0])} pitch {fmt(tool.rotation_deg[1])} yaw {fmt(tool.rotation_deg[2])} deg
          </>
        )}
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <div className="movej-grid">
          {POS.map((k, i) => (
            <label key={k} className="movej-cell">
              <span className="small mono">{k.toUpperCase()}</span>
              <input
                type="text"
                inputMode="decimal"
                className="mono"
                value={draft[k] ?? ""}
                placeholder={fmt(tool.position_mm[i])}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                aria-label={`Target ${k.toUpperCase()} (mm)`}
              />
              <span className="muted small">mm</span>
            </label>
          ))}
          {orient &&
            ROT.map((k, i) => (
              <label key={k} className="movej-cell">
                <span className="small">{k}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="mono"
                  value={draft[k] ?? ""}
                  placeholder={`${fmt(tool.rotation_deg[i])} (keep)`}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  aria-label={`Target ${k} (deg)`}
                />
                <span className="muted small">deg</span>
              </label>
            ))}
        </div>
        <div className="btn-row">
          <div className="seg" role="radiogroup" aria-label="Tool speed">
            {SPEEDS_MM_S.map((v) => (
              <button type="button" key={v} role="radio" aria-checked={speed === v} className={`seg-btn ${speed === v ? "active" : ""}`} onClick={() => setSpeed(v)}>
                {v} mm/s
              </button>
            ))}
          </div>
          <button type="submit" className="btn btn-primary" disabled={why !== null}>
            Move in a line
          </button>
          <button type="button" className="btn" onClick={fill}>
            Fill current
          </button>
          <button type="button" className="btn" onClick={() => setDraft({})} disabled={Object.keys(draft).length === 0}>
            Clear
          </button>
        </div>
        {Object.keys(draft).length > 0 && why && <div className="small warn-text">{why}</div>}
      </form>
    </section>
  );
}
