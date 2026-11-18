import { useState } from "react";
import type { AxisConfig, AxisTelemetry } from "../../types/api";
import { useEngine, usePermissions, useTelemetry } from "../../hooks/useEngine";
import { useCommand } from "../../hooks/useCommand";
import { fmt } from "../../components/common";
import { allowed } from "./axes";
import type { Contact } from "./kinematics";
import { SPEEDS, jointMoveBlocker, sendJointMove, type JointTargets } from "./jointMove";

const STEPS = [0.1, 1, 10] as const;

export interface JointPanelProps {
  id: string;
  cfg: AxisConfig | null;
  tel: AxisTelemetry | null;
  /** Previewed target (deg / mm); null = no preview. Nothing is sent until Move. */
  preview: number | null;
  onPreview: (value: number | null) => void;
  onClose: () => void;
  /** First collision on the way to the previewed pose (engine's model), if any. */
  contact?: Contact | null;
  /** Targets previewed on other joints; Move sends them together with this one. */
  others?: JointTargets;
  /** Clears every previewed joint. */
  onClearAll?: () => void;
}

/**
 * Controls for the joint selected in the 3D viewer: jog, a preview target
 * (dragged in the view or set here) and an explicit Move. Targets previewed
 * on several joints are sent as one coordinated joint move (move_j): every
 * joint starts and finishes together. Same rules as the Motion screen; the
 * engine validates everything again.
 */
export function JointPanel({ id, cfg, tel, preview, onPreview, onClose, contact = null, others = {}, onClearAll }: JointPanelProps) {
  const run = useCommand();
  const perms = usePermissions();
  const s = useEngine();
  const { online, state, telemetry } = useTelemetry();
  const [step, setStep] = useState<number>(1);
  const [speed, setSpeed] = useState<number>(1);
  const [draft, setDraft] = useState<string | null>(null);

  const unit = cfg?.unit ?? "";
  const measured = tel?.measured_position ?? null;
  const value = preview ?? measured ?? 0;
  const canCommand = online && perms.command;
  const canJog = canCommand && allowed.jog(state);
  const hasPreview = preview !== null && measured !== null && Math.abs(preview - measured) > 1e-9;
  const otherIds = Object.keys(others).filter((o) => o !== id);
  const targets: JointTargets = { ...Object.fromEntries(otherIds.map((o) => [o, others[o]!])), ...(hasPreview ? { [id]: preview! } : {}) };
  const count = Object.keys(targets).length;
  const why =
    count === 0
      ? null
      : jointMoveBlocker({
          targets,
          axes: s.config?.axes ?? (cfg ? [cfg] : []),
          // This panel's own axis data wins for the selected joint.
          telemetry: telemetry && tel ? { ...telemetry, axes: telemetry.axes.map((a) => (a.id === id ? tel : a)) } : telemetry,
          online,
          canCommand: perms.command,
          state,
          apiVersion: s.info?.engine?.api_version,
          contact,
        });
  const canMove = count > 0 && why === null;

  const move = async () => {
    if (!canMove) return;
    if (await sendJointMove(run, targets, speed, s.config?.axes ?? (cfg ? [cfg] : []))) {
      onPreview(null);
      onClearAll?.();
    }
  };

  const commitDraft = () => {
    if (draft === null) return;
    const v = Number.parseFloat(draft);
    if (Number.isFinite(v)) onPreview(v);
    setDraft(null);
  };

  return (
    <section className="panel joint-panel" aria-label={`Joint ${id}`}>
      <div className="joint-panel-head">
        <div>
          <strong>{cfg?.name ?? id}</strong> <span className="muted mono">· {id}</span>
        </div>
        <button className="btn btn-small" onClick={onClose} aria-label="Close joint panel">
          ×
        </button>
      </div>

      <dl className="kv kv-inline small">
        <dt>Measured</dt>
        <dd className="mono">
          {fmt(measured)} {unit}
        </dd>
        <dt>Commanded</dt>
        <dd className="mono">
          {fmt(tel?.commanded_position)} {unit}
        </dd>
        <dt>Preview</dt>
        <dd className="mono preview-text">{hasPreview ? `${fmt(preview)} ${unit}` : "—"}</dd>
      </dl>

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

      {cfg && (
        <label className="joint-target">
          <span className="small muted">Target (preview)</span>
          <input
            type="range"
            min={cfg.min}
            max={cfg.max}
            step={cfg.unit === "mm" ? 1 : 0.5}
            value={Math.min(cfg.max, Math.max(cfg.min, value))}
            onChange={(e) => onPreview(Number(e.target.value))}
            aria-label={`Preview target for ${id}`}
          />
        </label>
      )}
      <div className="btn-row">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          className="joint-number"
          value={draft ?? (hasPreview ? String(Number(value.toFixed(3))) : "")}
          placeholder={`target ${unit}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => e.key === "Enter" && commitDraft()}
          aria-label={`Target value for ${id}`}
        />
        <button className="btn btn-primary" disabled={!canMove} onClick={() => void move()}>
          {count > 1 ? `Move ${count} joints together` : `Move${hasPreview ? ` to ${fmt(preview)}` : ""}`}
        </button>
        <button className="btn" disabled={!hasPreview} onClick={() => onPreview(null)}>
          Clear
        </button>
      </div>
      {otherIds.length > 0 && (
        <div className="small pose-others">
          <span className="muted">Also previewed: </span>
          <span className="mono preview-text">{otherIds.map((o) => `${o} → ${fmt(others[o])}`).join(", ")}</span>{" "}
          <button className="btn btn-small" onClick={() => onClearAll?.()}>
            Clear all
          </button>
        </div>
      )}
      {count > 0 && (
        <div className="speed-row small">
          <span className="muted">Speed</span>
          <div className="seg" role="radiogroup" aria-label="Move speed">
            {SPEEDS.map((v) => (
              <button key={v} role="radio" aria-checked={speed === v} className={`seg-btn ${speed === v ? "active" : ""}`} onClick={() => setSpeed(v)}>
                {v * 100}%
              </button>
            ))}
          </div>
        </div>
      )}
      {why && count > 0 && (
        <div className={`small ${contact ? "err-text" : "warn-text"}`} role={contact ? "alert" : undefined}>
          {why}
        </div>
      )}
      <div className="muted small">
        Drag the selected joint in the view or use the slider to preview a target (amber). Preview several joints to move them together. Nothing moves
        until you press Move.
      </div>
    </section>
  );
}
