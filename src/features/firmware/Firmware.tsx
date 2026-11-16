import { useState } from "react";
import { api } from "../../api";
import type { FirmwareJob } from "../../types/api";
import { useEngine, usePermissions, useTelemetry } from "../../hooks/useEngine";
import { usePolling } from "../../hooks/usePolling";
import { useErrorToast } from "../../hooks/useCommand";
import { useToast } from "../../components/Toasts";
import { Chip, Dialog, Empty, Panel, StateBadge, fmtUnix, type Tone } from "../../components/common";
import { buildEligibility, flashEligibility, isActive, logTail } from "./jobs";

const JOB_TONE: Record<string, Tone | undefined> = { queued: "info", running: "info", succeeded: "ok", failed: "err" };
const ACTIVE_POLL_MS = 1500;

/** Firmware Builder: targets, per-MCU builds, jobs with logs/artifacts, confirmed flashing. */
export function Firmware() {
  const { config } = useEngine();
  const targets = usePolling(api.firmware.targets, null);
  const [anyActive, setAnyActive] = useState(false);
  const jobs = usePolling(async () => {
    const list = await api.firmware.jobs();
    setAnyActive(list.some(isActive));
    return list;
  }, anyActive ? ACTIVE_POLL_MS : null);
  const toast = useToast();
  const fail = useErrorToast();
  const perms = usePermissions();
  const [busy, setBusy] = useState<string | null>(null);
  const [flashJob, setFlashJob] = useState<FirmwareJob | null>(null);

  const build = async (mcu: string) => {
    setBusy(mcu);
    try {
      const job = await api.firmware.build({ mcu });
      toast("info", `Build queued for ${mcu}`, job.id);
      await jobs.refresh();
    } catch (e) {
      fail(`Build (${mcu})`, e);
    } finally {
      setBusy(null);
    }
  };

  const flash = async (job: FirmwareJob) => {
    setFlashJob(null);
    try {
      const f = await api.firmware.flash(job.id);
      toast("info", `Flash queued for ${job.mcu}`, f.id);
      await jobs.refresh();
    } catch (e) {
      fail(`Flash (${job.mcu})`, e);
    }
  };

  const loadError = targets.error ?? jobs.error;

  return (
    <div className="stack">
      {loadError !== null && (
        <div className="note note-err">Firmware service unavailable: {loadError instanceof Error ? loadError.message : String(loadError)}</div>
      )}

      <Panel title="Build firmware">
        {!config ? (
          <Empty>Configuration unavailable — MCUs are taken from the robot configuration.</Empty>
        ) : config.mcus.length === 0 ? (
          <Empty>No MCUs configured.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>MCU</th>
                  <th>Board</th>
                  <th>Transport</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {config.mcus.map((m) => {
                  const el = buildEligibility(m, targets.data, jobs.data);
                  return (
                    <tr key={m.name}>
                      <td className="mono" data-label="MCU">{m.name}</td>
                      <td className="mono" data-label="Board">{m.board}</td>
                      <td data-label="Transport">{m.transport}</td>
                      <td className="actions" data-label="">
                        <button className="btn btn-primary btn-small" disabled={!el.ok || busy !== null || !perms.firmware_build} title={perms.firmware_build ? el.reason : "Requires the operator role"} onClick={() => void build(m.name)}>
                          {busy === m.name ? "Queuing…" : "Build firmware"}
                        </button>
                        {el.reason && <div className="muted small">{el.reason}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title={`Jobs${anyActive ? " · updating…" : ""}`}
        actions={
          <button className="btn btn-small" onClick={() => void jobs.refresh()}>
            Refresh
          </button>
        }
      >
        {jobs.data === null ? (
          <Empty>{jobs.loading ? "Loading…" : "Job list unavailable."}</Empty>
        ) : jobs.data.length === 0 ? (
          <Empty>No firmware jobs yet.</Empty>
        ) : (
          <div className="jobs">
            {jobs.data.map((j) => (
              <JobCard key={j.id} job={j} flash={perms.firmware_flash ? flashEligibility(j, targets.data, jobs.data) : { ok: false, reason: "Requires the admin role" }} onFlash={() => setFlashJob(j)} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Targets">
        {targets.data === null ? (
          <Empty>{targets.loading ? "Loading…" : "Target list unavailable."}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Board</th>
                  <th>Description</th>
                  <th>Firmware target</th>
                  <th>Rust target</th>
                  <th className="num">Step ch</th>
                  <th className="num">Max step rate</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {targets.data.map((t) => (
                  <tr key={t.board}>
                    <td className="mono" data-label="Board">{t.board}</td>
                    <td data-label="Description">{t.description}</td>
                    <td className="mono" data-label="Firmware target">{t.firmware_target}</td>
                    <td className="mono" data-label="Rust target">{t.rust_target}</td>
                    <td className="num" data-label="Step ch">{t.step_channels}</td>
                    <td className="num" data-label="Max step rate">{t.max_step_rate.toLocaleString()} Hz</td>
                    <td data-label="Flags">
                      <span className="chips">
                        {t.is_virtual && <Chip tone="dim">virtual</Chip>}
                        {t.provisional && <Chip tone="warn">provisional</Chip>}
                        {!t.is_virtual && !t.provisional && <span className="muted">—</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <FlashDialog job={flashJob} onCancel={() => setFlashJob(null)} onConfirm={(j) => void flash(j)} />
    </div>
  );
}

function JobCard({ job, flash, onFlash }: { job: FirmwareJob; flash: { ok: boolean; reason?: string }; onFlash: () => void }) {
  const a = job.artifact;
  const offerFlash = job.kind === "build" && job.state === "succeeded" && a !== null;
  return (
    <article className="job">
      <div className="job-head">
        <span className="mono">{job.id}</span>
        <Chip>{job.kind}</Chip>
        <span className="mono">{job.mcu}</span>
        <Chip tone={JOB_TONE[job.state]}>{job.state}</Chip>
        <span className="muted small">
          {fmtUnix(job.created_unix)}
          {job.finished_unix !== null && ` → ${fmtUnix(job.finished_unix)}`}
        </span>
        {offerFlash && (
          <button className="btn btn-warn btn-small job-action" disabled={!flash.ok} title={flash.reason} onClick={onFlash}>
            Flash…
          </button>
        )}
      </div>
      {job.message && <div className="small">{job.message}</div>}
      {a && (
        <dl className="kv kv-inline small">
          <dt>Board</dt>
          <dd className="mono">{a.board}</dd>
          <dt>Version</dt>
          <dd className="mono">{a.firmware_version}</dd>
          <dt>Build hash</dt>
          <dd className="mono">{a.build_hash}</dd>
          <dt>SHA-256</dt>
          <dd className="mono hash" title={a.image_sha256}>
            {a.image_sha256}
          </dd>
          <dt>Toolchain</dt>
          <dd className="mono">{a.toolchain}</dd>
          {a.required_capabilities.length > 0 && (
            <>
              <dt>Requires</dt>
              <dd className="mono">{a.required_capabilities.join(", ")}</dd>
            </>
          )}
        </dl>
      )}
      {job.log && (
        <>
          <pre className="job-tail" aria-label="Log tail">
            {logTail(job.log)}
          </pre>
          <details className="job-log">
            <summary className="small muted">Full log</summary>
            <pre>{job.log}</pre>
          </details>
        </>
      )}
    </article>
  );
}

function FlashDialog({ job, onCancel, onConfirm }: { job: FirmwareJob | null; onCancel: () => void; onConfirm: (j: FirmwareJob) => void }) {
  const [ack, setAck] = useState(false);
  const { state } = useTelemetry();
  const close = () => {
    setAck(false);
    onCancel();
  };
  return (
    <Dialog open={job !== null} onClose={close} title="Flash firmware">
      {job && (
        <form
          method="dialog"
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ack) return;
            setAck(false);
            onConfirm(job);
          }}
        >
          <p>
            Flash build <span className="mono">{job.id}</span>
            {job.artifact && (
              <>
                {" "}
                (<span className="mono">{job.artifact.board}</span>, build <span className="mono">{job.artifact.build_hash}</span>)
              </>
            )}{" "}
            to MCU <span className="mono">{job.mcu}</span>.
          </p>
          <div className="note note-err">
            Flashing resets the MCU. All motion stops and the link drops until the new firmware identifies itself. Make sure the{" "}
            <strong>drives are powered off</strong> before continuing.
          </div>
          <div className="small">
            Robot state: <StateBadge state={state} />
          </div>
          <label className="check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} autoFocus />
            I confirm the drives are powered off.
          </label>
          <div className="btn-row dialog-actions">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-warn" disabled={!ack}>
              Flash firmware
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
