import { useEngine, useTelemetry } from "../../hooks/useEngine";
import { useCommand } from "../../hooks/useCommand";
import { Empty, Led, Panel, Row, StateBadge, fmt, txt } from "../../components/common";
import { allowed, mergeAxes } from "../motion/axes";
import { deriveAlarms } from "./alarms";

/** Overview: robot, state, active fault/alarms, MCU health, axis summary. */
export function Dashboard() {
  const s = useEngine();
  const { telemetry: t, online, state } = useTelemetry();
  const run = useCommand();
  const alarms = deriveAlarms(s);
  const axes = mergeAxes(s.config?.axes ?? null, t?.axes ?? []);
  const mcu = t?.mcu ?? null;
  const qPct = mcu && mcu.queue_capacity > 0 ? (mcu.queue_depth / mcu.queue_capacity) * 100 : 0;

  return (
    <div className="dash-grid">
      <Panel title="Robot" className="dash-robot">
        <div className="dash-name">{s.config?.name ?? "—"}</div>
        <div className="mono small muted">{s.config?.profile ?? ""}</div>
        <div className="robot-state">
          <span className="label">State</span>
          <StateBadge state={state} />
          {t && <span className="muted small">seq {t.seq}</span>}
        </div>
        {online && allowed.reset_fault(state) && (
          <button className="btn btn-warn" onClick={() => void run("reset_fault", {})}>
            Reset Fault
          </button>
        )}
        <dl className="kv small">
          <Row k="Server" v={txt(s.info?.server_version)} />
          <Row k="Engine" v={txt(s.info?.engine?.engine_version)} />
          <Row k="Engine API" v={txt(s.info?.engine?.api_version)} />
        </dl>
      </Panel>

      <Panel title={`Alarms${alarms.length ? ` (${alarms.length})` : ""}`} className="dash-alarms">
        {alarms.length === 0 ? (
          <div className="ok-text">No active fault or alarms.</div>
        ) : (
          <ul className="alarms">
            {alarms.map((a, i) => (
              <li key={i} className={`alarm alarm-${a.severity}`}>
                <strong>{a.title}</strong>
                {a.detail && <span className="small"> — {a.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="MCU health" className={`dash-mcu ${s.engineConnected ? "" : "stale"}`}>
        {!mcu ? (
          <Empty>No telemetry.</Empty>
        ) : (
          <>
            <Led on={mcu.connected} label={mcu.connected ? "link up" : "link down"} color={mcu.connected ? "ok" : "err"} />
            <dl className="kv">
              <Row k="Board" v={txt(mcu.board)} />
              <Row k="Firmware" v={txt(mcu.firmware_version)} />
              <Row k="Build" v={<span className="mono">{txt(mcu.build_hash)}</span>} />
              <Row k="RTT" v={`${mcu.rtt_us} µs`} warn={mcu.rtt_us > 5000} />
              <Row k="CRC errors" v={mcu.crc_errors} warn={mcu.crc_errors > 0} />
              <Row k="Heartbeat" v={mcu.last_heartbeat_ms_ago === null ? "—" : `${mcu.last_heartbeat_ms_ago} ms ago`} />
            </dl>
            <div className="queue">
              <div className="queue-label">
                <span className="label">Queue</span>
                <span className="mono">
                  {mcu.queue_depth} / {mcu.queue_capacity}
                </span>
              </div>
              <div className="bar">
                <div className={`bar-fill ${qPct > 85 ? "bar-hot" : ""}`} style={{ width: `${qPct}%` }} />
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Axes" className="dash-axes">
        {axes.length === 0 ? (
          <Empty>No axes reported yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Axis</th>
                  <th className="num">Measured</th>
                  <th className="num">Commanded</th>
                  <th className="num">Velocity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {axes.map(({ id, cfg, tel }) => (
                  <tr key={id}>
                    <td data-label="Axis">
                      {cfg?.name ?? id} <span className="mono muted">· {id}</span>
                    </td>
                    <td className="num" data-label="Measured">
                      {fmt(tel?.measured_position)} {cfg?.unit}
                    </td>
                    <td className="num" data-label="Commanded">
                      {fmt(tel?.commanded_position)} {cfg?.unit}
                    </td>
                    <td className="num" data-label="Velocity">
                      {fmt(tel?.velocity)}
                    </td>
                    <td data-label="Status">
                      <span className="leds">
                        <Led on={tel?.homed ?? false} label="homed" />
                        <Led on={tel?.enabled ?? false} label="enabled" />
                        <Led on={tel?.endstop ?? false} color="warn" label="endstop" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
