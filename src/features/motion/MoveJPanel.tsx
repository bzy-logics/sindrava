import { useMemo, useState, type FormEvent } from "react";
import { useEngine, usePermissions, useTelemetry } from "../../hooks/useEngine";
import { useCommand } from "../../hooks/useCommand";
import { fmt } from "../../components/common";
import { SPEEDS, jointMoveBlocker, pathContact, sendJointMove, type JointTargets } from "./jointMove";

/**
 * Coordinated joint move (MoveJ, engine-api >= 0.2): type targets for any
 * joints (blank = hold) and move them together. Every listed joint starts and
 * finishes at the same time on a straight line in joint space, at the speed
 * of the slowest one. One joint is sent as an ordinary move_to.
 */
export function MoveJPanel() {
  const s = useEngine();
  const run = useCommand();
  const perms = usePermissions();
  const { telemetry: t, online, state } = useTelemetry();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [speed, setSpeed] = useState<number>(0.5);
  const cfgs = s.config?.axes ?? [];

  const targets: JointTargets = useMemo(() => {
    const out: JointTargets = {};
    for (const a of cfgs) {
      const raw = draft[a.id]?.trim();
      if (!raw) continue;
      const v = Number(raw);
      const now = t?.axes.find((x) => x.id === a.id)?.commanded_position;
      // A target equal to where the joint already is just holds it.
      if (Number.isFinite(v) && (now === undefined || Math.abs(v - now) > 1e-6)) out[a.id] = v;
    }
    return out;
  }, [draft, cfgs, t]);
  const invalid = cfgs.filter((a) => (draft[a.id]?.trim() ?? "") !== "" && !Number.isFinite(Number(draft[a.id]))).map((a) => a.id);
  const count = Object.keys(targets).length;
  const commandedKey = (t?.axes ?? []).map((a) => `${a.id}=${a.commanded_position.toFixed(3)}:${a.homed}`).join("|");
  const contact = useMemo(() => pathContact(s.config, t, targets), [targets, commandedKey, s.config]);
  const why =
    invalid.length > 0
      ? `Not a number: ${invalid.join(", ")}.`
      : jointMoveBlocker({ targets, axes: cfgs, telemetry: t, online, canCommand: perms.command, state, apiVersion: s.info?.engine?.api_version, contact });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (why !== null) return;
    if (await sendJointMove(run, targets, speed, cfgs)) setDraft({});
  };
  const fillCurrent = () =>
    setDraft(Object.fromEntries(cfgs.map((a) => [a.id, String(Number((t?.axes.find((x) => x.id === a.id)?.commanded_position ?? 0).toFixed(2)))])));

  return (
    <section className="panel movej-panel" aria-label="Coordinated joint move">
      <div className="panel-head">
        <h2>Joint move</h2>
        <span className="muted small">All listed joints start and finish together.</span>
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <div className="movej-grid">
          {cfgs.map((a) => {
            const tel = t?.axes.find((x) => x.id === a.id);
            return (
              <label key={a.id} className="movej-cell">
                <span className="small">
                  <span className="mono">{a.id}</span> <span className="muted">{a.name}</span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="mono"
                  value={draft[a.id] ?? ""}
                  placeholder={tel ? `${fmt(tel.commanded_position)} (hold)` : "hold"}
                  onChange={(e) => setDraft((d) => ({ ...d, [a.id]: e.target.value }))}
                  aria-label={`Target for ${a.id} (${a.unit})`}
                />
                <span className="muted small">
                  [{a.min}, {a.max}] {a.unit}
                </span>
              </label>
            );
          })}
        </div>
        <div className="btn-row">
          <div className="seg" role="radiogroup" aria-label="Joint move speed">
            {SPEEDS.map((v) => (
              <button type="button" key={v} role="radio" aria-checked={speed === v} className={`seg-btn ${speed === v ? "active" : ""}`} onClick={() => setSpeed(v)}>
                {v * 100}%
              </button>
            ))}
          </div>
          <button type="submit" className="btn btn-primary" disabled={count === 0 || why !== null}>
            {count > 1 ? `Move ${count} joints together` : count === 1 ? "Move 1 joint" : "Move"}
          </button>
          <button type="button" className="btn" onClick={fillCurrent} disabled={!t}>
            Fill current
          </button>
          <button type="button" className="btn" onClick={() => setDraft({})} disabled={Object.keys(draft).length === 0}>
            Clear
          </button>
        </div>
        {count > 0 && why && (
          <div className={`small ${contact ? "err-text" : "warn-text"}`} role={contact ? "alert" : undefined}>
            {why}
          </div>
        )}
      </form>
    </section>
  );
}
