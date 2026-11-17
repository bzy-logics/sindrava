import { useState, type FormEvent } from "react";
import type { RobotState } from "../../types/api";
import { useEngine, usePermissions, useTelemetry } from "../../hooks/useEngine";
import { useCommand } from "../../hooks/useCommand";
import { Empty, Led, StateBadge, fmt } from "../../components/common";
import { ConfirmButton } from "../../components/ConfirmButton";
import { allowed, mergeAxes, type MergedAxis } from "./axes";
import { homeableAxes } from "../../hooks/homeAll";
import { homeAll, useHomeAll } from "../../hooks/useHomeAll";

const NEEDS_OPERATOR = "Requires the operator role";

const RESET_TEXT = (
  <p>
    Clear the latched fault? The robot returns to <strong>disabled</strong>; drives stay off and motion never resumes automatically. Make sure the cause
    has been removed (the MCU refuses the reset while, for example, an endstop is still pressed or the safety interlock is open).
  </p>
);

const STEPS = [0.1, 1, 10] as const;

export function MotionControl() {
  const s = useEngine();
  const run = useCommand();
  const perms = usePermissions();
  const { telemetry: t, online, state } = useTelemetry();
  const cmdTitle = perms.command ? undefined : NEEDS_OPERATOR;

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
          <ConfirmButton
            className="btn btn-warn"
            disabled={!online || !allowed.reset_fault(state) || !perms.command}
            title={cmdTitle}
            confirmTitle="Reset fault"
            confirmText={RESET_TEXT}
            confirmLabel="Reset fault"
            onConfirm={() => void run("reset_fault", {})}
          >
            Reset Fault
          </ConfirmButton>
        </div>
      )}
      {!t?.fault && online && allowed.reset_fault(state) && (
        <div className="fault" role="alert">
          <div>
            <div className="fault-code">{state.replace("_", " ").toUpperCase()}</div>
            <div className="fault-msg">Reset to return to the disabled state. Motion never resumes automatically.</div>
          </div>
          <ConfirmButton
            className="btn btn-warn"
            disabled={!perms.command}
            title={cmdTitle}
            confirmTitle="Reset emergency stop"
            confirmText={RESET_TEXT}
            confirmLabel="Reset"
            onConfirm={() => void run("reset_fault", {})}
          >
            Reset Fault
          </ConfirmButton>
        </div>
      )}

      <section className="panel robot-panel">
        <div className="robot-state">
          <span className="label">Robot state</span>
          <StateBadge state={state} />
          {t && <span className="muted small">seq {t.seq}</span>}
        </div>
        <div className="btn-row">
          <ConfirmButton
            className="btn btn-ok"
            disabled={!online || !allowed.enable(state) || !perms.command}
            title={cmdTitle}
            confirmTitle="Enable drives"
            confirmText={<p>Energise all drives? Make sure the work area is clear and the hardware E-stop is within reach.</p>}
            confirmLabel="Enable drives"
            onConfirm={() => void run("enable", {})}
          >
            Enable
          </ConfirmButton>
          <button className="btn" disabled={!online || !allowed.disable(state) || !perms.command} title={cmdTitle} onClick={() => void run("disable", {})}>
            Disable
          </button>
          <button className="btn btn-warn" disabled={!online || !allowed.stop(state) || !perms.stop} onClick={() => void run("stop", {})}>
            Stop
          </button>
          <HomeAllButton />
        </div>
        <HomeAllStatus />
      </section>

      {axes.length === 0 ? (
        <Empty>No axes reported yet. Waiting for configuration / telemetry…</Empty>
      ) : (
        <>
          {axes.length > 1 && (
            <div className="note small">
              Each command moves one axis. Coordinated multi-axis moves are not provided by the engine yet, so axes are not synchronised with each
              other.
            </div>
          )}
        <div className="axis-grid">
          {axes.map(({ cfg, tel, id }) => (
            <AxisCard key={id} id={id} cfg={cfg} tel={tel} state={state} online={online && perms.command} />
          ))}
        </div>
        </>
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
        <ConfirmButton
          className="btn"
          disabled={!online || !allowed.home(state)}
          confirmTitle={`Home ${cfg?.name ?? id}`}
          confirmText={
            <p>
              Axis <span className="mono">{id}</span> will move{cfg ? "" : " (direction from the configuration)"} until its endstop triggers. Make sure the
              path is clear.
            </p>
          }
          confirmLabel="Start homing"
          onConfirm={() => void run("home", { axis: id })}
        >
          Home
        </ConfirmButton>
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

/** Home every homeable axis in profile order (confirmed first). */
function HomeAllButton() {
  const s = useEngine();
  const perms = usePermissions();
  const { online, state } = useTelemetry();
  const ha = useHomeAll();
  const ids = homeableAxes(s.config?.axes);
  const skipped = (s.config?.axes.length ?? 0) - ids.length;
  const busy = ha.kind === "running";
  // engine-api >= 1.2: the engine runs the profile's plan (groups together).
  const plan = s.config?.home_all ?? null;
  const groups = plan ? plan.groups.filter((g) => g.length > 0) : [];
  const total = plan ? groups.flat().length : ids.length;
  return (
    <ConfirmButton
      className="btn"
      disabled={!online || !allowed.home(state) || !perms.command || total === 0 || busy}
      title={!perms.command ? "Requires the operator role" : ids.length === 0 ? "No axis has a homing configuration" : undefined}
      confirmTitle="Home all axes"
      confirmText={
        plan ? (
          <div className="stack">
            <p>
              Home {total} {total === 1 ? "axis" : "axes"} in {groups.length} {groups.length === 1 ? "step" : "steps"}. The axes of one step move at the
              same time, each until its endstop triggers:
            </p>
            <ol className="home-plan">
              {groups.map((g, i) => (
                <li key={i}>
                  <span className="mono">{g.join(", ")}</span>
                  {g.length > 1 && <span className="muted"> together</span>}
                </li>
              ))}
            </ol>
            <div className="note note-err">
              <strong>Start pose:</strong> {plan.start_pose || "not specified in the robot profile."} Joint positions are unknown until each joint
              reaches its switch, so no software can check these paths: make sure the robot is in this pose and every path is clear.
            </div>
            {s.config?.collision_checking && <p className="small muted">Once homed, moves that would make the robot collide with itself are refused.</p>}
          </div>
        ) : (
          <p>
            Home {ids.length} {ids.length === 1 ? "axis" : "axes"} one after the other, in this order:{" "}
            <span className="mono">{ids.join(" → ")}</span>. Each axis moves until its endstop triggers; make sure every path is clear.
            {skipped > 0 && ` ${skipped} ${skipped === 1 ? "axis has" : "axes have"} no homing configuration and will be skipped.`} The sequence stops on
            any fault, emergency stop or loss of live data.
          </p>
        )
      }
      confirmLabel={`Home ${total} ${total === 1 ? "axis" : "axes"}`}
      onConfirm={() => void (plan ? homeAll.startPlan(groups) : homeAll.start(ids))}
    >
      Home all
    </ConfirmButton>
  );
}

/** Progress and outcome of "Home all". */
function HomeAllStatus() {
  const ha = useHomeAll();
  const perms = usePermissions();
  switch (ha.kind) {
    case "idle":
      return null;
    case "running":
      return (
        <div className="home-all" role="status">
          <span>
            Homing <span className="mono">{ha.axes[ha.index]}</span> ({ha.index + 1}/{ha.axes.length})…
          </span>
          <button className="btn btn-warn btn-small" disabled={!perms.stop} onClick={() => void homeAll.cancel()}>
            Cancel
          </button>
        </div>
      );
    case "done":
      return (
        <div className="home-all home-all-ok" role="status">
          <span>
            All {ha.axes.flatMap((l) => l.split(", ")).length} {ha.axes.flatMap((l) => l.split(", ")).length === 1 ? "axis" : "axes"} homed.
          </span>
          <button className="btn btn-small" onClick={() => homeAll.dismiss()} aria-label="Dismiss">
            ×
          </button>
        </div>
      );
    case "failed":
      return (
        <div className="home-all home-all-err" role="alert">
          <span>
            Home all stopped at <span className="mono">{ha.axes[ha.index]}</span> ({ha.index + 1}/{ha.axes.length}): {ha.reason}
          </span>
          <button className="btn btn-small" onClick={() => homeAll.dismiss()} aria-label="Dismiss">
            ×
          </button>
        </div>
      );
    case "cancelled":
      return (
        <div className="home-all" role="status">
          <span>
            Home all cancelled at <span className="mono">{ha.axes[ha.index]}</span>; {ha.axes[ha.index]?.includes(",") ? "those axes are" : "that axis is"} not
            homed.
          </span>
          <button className="btn btn-small" onClick={() => homeAll.dismiss()} aria-label="Dismiss">
            ×
          </button>
        </div>
      );
  }
}
