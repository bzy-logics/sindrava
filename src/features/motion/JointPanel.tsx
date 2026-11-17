import { useState } from "react";
import type { AxisConfig, AxisTelemetry } from "../../types/api";
import { usePermissions, useTelemetry } from "../../hooks/useEngine";
import { useCommand } from "../../hooks/useCommand";
import { fmt } from "../../components/common";
import { allowed } from "./axes";
import type { Contact } from "./kinematics";

const STEPS = [0.1, 1, 10] as const;

export interface JointPanelProps {
  id: string;
  cfg: AxisConfig | null;
  tel: AxisTelemetry | null;
  /** Previewed target (deg / mm); null = no preview. Nothing is sent until Move. */
  preview: number | null;
  onPreview: (value: number | null) => void;
  onClose: () => void;
  /** First collision on the way to the preview target (engine's model), if any. */
  contact?: Contact | null;
}

/**
 * Controls for the joint selected in the 3D viewer: jog, a preview target
 * (dragged in the view or set here) and an explicit Move. Uses the same
 * commands and the same rules as the Motion screen; the engine validates
 * everything again.
 */
export function JointPanel({ id, cfg, tel, preview, onPreview, onClose, contact = null }: JointPanelProps) {
  const run = useCommand();
  const perms = usePermissions();
  const { online, state } = useTelemetry();
  const [step, setStep] = useState<number>(1);
  const [draft, setDraft] = useState<string | null>(null);

  const unit = cfg?.unit ?? "";
  const measured = tel?.measured_position ?? null;
  const homed = tel?.homed ?? false;
  const value = preview ?? measured ?? 0;
  const inLimits = !cfg || (value >= cfg.min && value <= cfg.max);
  const canCommand = online && perms.command;
  const canJog = canCommand && allowed.jog(state);
  const hasPreview = preview !== null && measured !== null && Math.abs(preview - measured) > 1e-9;
  const canMove = canCommand && allowed.move_to(state) && homed && hasPreview && inLimits && contact === null;

  let why: string | null = null;
  if (!online) why = "Live data required.";
  else if (!perms.command) why = "Requires the operator role.";
  else if (!homed) why = "Home this axis first (Motion screen) to move to an absolute target.";
  else if (!inLimits) why = `Target outside the soft limits [${cfg?.min}, ${cfg?.max}] ${unit}.`;
  else if (contact) {
    const at = contact.at[id];
    why =
      contact.b === "floor"
        ? `Would hit the floor (link of ${contact.a}) when ${id} reaches ${fmt(at, 1)} ${unit}; the engine refuses this move.`
        : `Would collide: links of ${contact.a} and ${contact.b} when ${id} reaches ${fmt(at, 1)} ${unit}; the engine refuses this move.`;
  }
  else if (!allowed.move_to(state)) why = `Robot is ${state.replace("_", " ")}; it must be ready.`;

  const move = async () => {
    if (!canMove || preview === null) return;
    if (await run("move_to", { axis: id, position: preview })) onPreview(null);
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
          Move{hasPreview ? ` to ${fmt(preview)}` : ""}
        </button>
        <button className="btn" disabled={!hasPreview} onClick={() => onPreview(null)}>
          Clear
        </button>
      </div>
      {why && hasPreview && (
        <div className={`small ${contact ? "err-text" : "warn-text"}`} role={contact ? "alert" : undefined}>
          {why}
        </div>
      )}
      <div className="muted small">
        Drag the selected joint in the view or use the slider to preview a target (amber). Nothing moves until you press Move.
      </div>
    </section>
  );
}
