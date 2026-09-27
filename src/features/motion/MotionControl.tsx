import { useState, type FormEvent } from "react";
import type { RobotState } from "../../types/api";
import { useEngine, useTelemetry } from "../../hooks/useEngine";
import { useCommand } from "../../hooks/useCommand";
import { Empty, Led, StateBadge, fmt } from "../../components/common";
import { allowed, mergeAxes, type MergedAxis } from "./axes";

const STEPS = [0.1, 1, 10] as const;

export function MotionControl() {
  const s = useEngine();
  const run = useCommand();
  const { telemetry: t, online, state } = useTelemetry();

  const axes = mergeAxes(s.config?.axes ?? null, t?.axes ?? []);

  return (
    <div className="stack">
      {t?.fault && (
        <div className="fault" role="alert">
          <div>
            <div className="fault-code">FAULT · {t.fault.code}</div>
            <div className="fault-msg">
              {t.fault.message}
              {t.fault.axis && <span className="muted"> (axis {t.fault.axis})</span>}
            </div>
          </div>
          <button className="btn btn-warn" disabled={!online || !allowed.reset_fault(state)} onClick={() => void run("reset_fault", {})}>
            Reset Fault
          </button>
        </div>
      )}
      {!t?.fault && online && allowed.reset_fault(state) && (
        <div className="fault" role="alert">
          <div>
            <div className="fault-code">{state.replace("_", " ").toUpperCase()}</div>
            <div className="fault-msg">Reset to return to the disabled state. Motion never resumes automatically.</div>
          </div>
          <button className="btn btn-warn" onClick={() => void run("reset_fault", {})}>
            Reset Fault
          </button>
        </div>
      )}

      <section className="panel robot-panel">
        <div className="robot-state">
          <span className="label">Robot state</span>
          <StateBadge state={state} />
          {t && <span className="muted small">seq {t.seq}</span>}
        </div>
        <div className="btn-row">
          <button className="btn btn-ok" disabled={!online || !allowed.enable(state)} onClick={() => void run("enable", {})}>
            Enable
          </button>
          <button className="btn" disabled={!online || !allowed.disable(state)} onClick={() => void run("disable", {})}>
            Disable
          </button>
          <button className="btn btn-warn" disabled={!online || !allowed.stop(state)} onClick={() => void run("stop", {})}>
            Stop
          </button>
        </div>
      </section>

      {axes.length === 0 ? (
        <Empty>No axes reported yet. Waiting for configuration / telemetry…</Empty>
      ) : (
        <div className="axis-grid">
          {axes.map(({ cfg, tel, id }) => (
            <AxisCard key={id} id={id} cfg={cfg} tel={tel} state={state} online={online} />
          ))}
        </div>
      )}
    </div>
  );
}

function AxisCard({ id, cfg, tel, state, online }: MergedAxis & { state: RobotState; online: boolean }) {
  const run = useCommand();
  const [step, setStep] = useState<number>(1);
  const [target, setTarget] = useState<string>("");
  const unit = cfg?.unit ?? "";
  const homed = tel?.homed ?? false;
  const canJog = online && allowed.jog(state);
  const canMove = online && allowed.move_to(state) && homed;
  const targetNum = Number.parseFloat(target);
  const targetValid = target.trim() !== "" && Number.isFinite(targetNum) && (!cfg || (targetNum >= cfg.min && targetNum <= cfg.max));

  const pos = tel?.measured_position ?? null;
  const span = cfg ? cfg.max - cfg.min : 0;
  const pct = (v: number) => (cfg && span > 0 ? Math.min(100, Math.max(0, ((v - cfg.min) / span) * 100)) : 50);

  const submitMove = (e: FormEvent) => {
    e.preventDefault();
    if (canMove && targetValid) void run("move_to", { axis: id, position: targetNum });
  };

  return (
    <section className="panel axis-card">
      <div className="axis-head">
        <div>
          <div className="axis-title">
            {cfg?.name ?? id} <span className="muted">· {id}</span>
          </div>
          <div className="muted small">
            {cfg ? `${cfg.kind} · ${cfg.unit} · ${cfg.mcu} ch ${cfg.mcu_channel}` : "no config"}
          </div>
        </div>
        <div className="leds">
          <Led on={homed} label="homed" />
          <Led on={tel?.enabled ?? false} label="enabled" />
          <Led on={tel?.endstop ?? false} color="warn" label="endstop" />
        </div>
      </div>

      <div className="readouts">
        <div className="readout">
          <span className="label">Measured</span>
          <span className="value">{fmt(pos)}</span>
          <span className="unit">{unit}</span>
        </div>
        <div className="readout">
          <span className="label">Commanded</span>
          <span className="value value-dim">{fmt(tel?.commanded_position)}</span>
          <span className="unit">{unit}</span>
        </div>
        <div className="readout">
          <span className="label">Velocity</span>
          <span className="value value-dim">{fmt(tel?.velocity)}</span>
          <span className="unit">{unit}/s</span>
        </div>
      </div>

      {cfg && (
        <div className="limits">
          <div className="limit-bar" aria-label="Position within soft limits">
            {tel && <div className="limit-cmd" style={{ left: `${pct(tel.commanded_position)}%` }} />}
            {pos !== null && <div className="limit-pos" style={{ left: `${pct(pos)}%` }} />}
            {cfg.home_position !== null && <div className="limit-home" style={{ left: `${pct(cfg.home_position)}%` }} title={`home ${cfg.home_position}`} />}
          </div>
          <div className="limit-labels">
            <span>{fmt(cfg.min, 1)}</span>
            <span className="muted">soft limits · vmax {fmt(cfg.max_velocity, 0)} {unit}/s</span>
            <span>{fmt(cfg.max, 1)}</span>
          </div>
        </div>
      )}

      <div className="jog">
        <div className="seg" role="radiogroup" aria-label="Jog step">
          {STEPS.map((v) => (
            <button key={v} role="radio" aria-checked={step === v} className={`seg-btn ${step === v ? "active" : ""}`} onClick={() => setStep(v)}>
              {v}
            </button>
          ))}
        </div>
        <div className="jog-btns">
          <button className="btn jog-btn" disabled={!canJog} onClick={() => void run("jog", { axis: id, delta: -step })}>
            − {step}
          </button>
          <button className="btn jog-btn" disabled={!canJog} onClick={() => void run("jog", { axis: id, delta: step })}>
            + {step}
          </button>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn" disabled={!online || !allowed.home(state)} onClick={() => void run("home", { axis: id })}>
          Home
        </button>
        <form className="move" onSubmit={submitMove}>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={cfg?.min}
            max={cfg?.max}
            placeholder={homed ? `target ${unit}` : "home first"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={!canMove}
            aria-label={`Absolute target for ${id}`}
          />
          <button className="btn btn-primary" type="submit" disabled={!canMove || !targetValid}>
            Move
          </button>
        </form>
      </div>
      {!homed && <div className="muted small">Absolute moves are disabled until the axis is homed.</div>}
    </section>
  );
}
