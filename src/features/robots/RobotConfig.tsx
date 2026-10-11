import { live } from "../../hooks/liveStore";
import { useEngine } from "../../hooks/useEngine";
import { Empty, Panel, txt } from "../../components/common";

/** Read-only RobotConfig: robot, MCUs, axes with limits and wiring. */
export function RobotConfigView() {
  const { config } = useEngine();
  const refresh = (
    <button className="btn btn-small" onClick={() => live.refreshStatic()}>
      Refresh
    </button>
  );
  return (
    <div className="stack">
      <div className="note">
        Read-only. Editing robot configuration arrives with the <strong>Robot Composer</strong>.
      </div>
      <Panel title="Robot" actions={refresh}>
        {!config ? (
          <Empty>Configuration unavailable (engine not connected or not authorized?).</Empty>
        ) : (
          <dl className="kv kv-inline">
            <dt>Name</dt>
            <dd>{config.name}</dd>
            <dt>Profile</dt>
            <dd className="mono">{config.profile}</dd>
            <dt>MCUs</dt>
            <dd>{config.mcus.length}</dd>
            <dt>Axes</dt>
            <dd>{config.axes.length}</dd>
          </dl>
        )}
      </Panel>

      {config && (
        <Panel title="MCUs">
          {config.mcus.length === 0 ? (
            <Empty>No MCUs configured.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Board</th>
                    <th>Transport</th>
                    <th className="num">Watchdog</th>
                    <th className="num">Axes</th>
                  </tr>
                </thead>
                <tbody>
                  {config.mcus.map((m) => (
                    <tr key={m.name}>
                      <td className="mono" data-label="Name">{m.name}</td>
                      <td className="mono" data-label="Board">{m.board}</td>
                      <td data-label="Transport">{m.transport}</td>
                      <td className="num" data-label="Watchdog">{m.watchdog_ms} ms</td>
                      <td className="num" data-label="Axes">{config.axes.filter((a) => a.mcu === m.name).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {config && (
        <Panel title="Axes">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Kind</th>
                  <th className="num">Min</th>
                  <th className="num">Max</th>
                  <th className="num">Max vel</th>
                  <th className="num">Max accel</th>
                  <th className="num">Home</th>
                  <th className="num">Steps/unit</th>
                  <th>MCU / ch</th>
                  <th>Actuator</th>
                  <th>Step / Dir / En</th>
                  <th>Endstop</th>
                </tr>
              </thead>
              <tbody>
                {config.axes.map((a) => (
                  <tr key={a.id}>
                    <td className="mono" data-label="ID">{a.id}</td>
                    <td data-label="Name">{a.name}</td>
                    <td data-label="Kind">{a.kind}</td>
                    <td className="num" data-label="Min">{a.min} {a.unit}</td>
                    <td className="num" data-label="Max">{a.max} {a.unit}</td>
                    <td className="num" data-label="Max vel">{a.max_velocity} {a.unit}/s</td>
                    <td className="num" data-label="Max accel">{a.max_acceleration} {a.unit}/s²</td>
                    <td className="num" data-label="Home">{a.home_position === null ? "—" : `${a.home_position} ${a.unit}`}</td>
                    <td className="num" data-label="Steps/unit">{a.steps_per_unit}</td>
                    <td className="mono" data-label="MCU / ch">{a.mcu} / {a.mcu_channel}</td>
                    <td className="mono small" data-label="Actuator">{a.actuator}</td>
                    <td className="mono" data-label="Step / Dir / En">{txt(a.step_pin)} / {txt(a.dir_pin)} / {txt(a.enable_pin)}</td>
                    <td className="mono" data-label="Endstop">{txt(a.endstop_pin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
