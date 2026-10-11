import { useEngine } from "../../hooks/useEngine";
import { Chip, Empty, Panel, txt } from "../../components/common";
import { buildDeviceGraph } from "./graph";

function Pin({ label, pin }: { label: string; pin: string | null }) {
  return (
    <span className="pin">
      <span className="pin-label">{label}</span>
      <span className="mono">{txt(pin)}</span>
    </span>
  );
}

/** Read-only device graph of the configured robot. */
export function Composer() {
  const { config } = useEngine();
  return (
    <div className="stack">
      <div className="note">
        <strong>Robot Composer — read-only preview.</strong> This shows how the current configuration wires the robot to its MCUs, channels,
        drivers and endstops. Editing (adding MCUs/axes, reassigning pins, choosing actuator plugins) comes in a later release.
      </div>
      <Panel title="Device graph">
        {!config ? (
          <Empty>Configuration unavailable (engine not connected or not authorized?).</Empty>
        ) : (
          <ul className="graph" aria-label="Robot device graph">
            <li>
              <div className="node node-robot">
                <span className="node-kind">Robot</span>
                <strong>{config.name}</strong>
                <span className="mono small muted">{config.profile}</span>
              </div>
              <ul>
                {buildDeviceGraph(config).map((g) => (
                  <li key={g.name}>
                    <div className={`node node-mcu ${g.mcu ? "" : "node-missing"}`}>
                      <span className="node-kind">MCU</span>
                      <strong className="mono">{g.name}</strong>
                      {g.mcu ? (
                        <span className="small muted">
                          {g.mcu.board} · {g.mcu.transport} · watchdog {g.mcu.watchdog_ms} ms
                        </span>
                      ) : (
                        <Chip tone="err">not declared in mcus[]</Chip>
                      )}
                    </div>
                    {g.axes.length === 0 ? (
                      <ul>
                        <li>
                          <div className="node node-empty muted small">no channels in use</div>
                        </li>
                      </ul>
                    ) : (
                      <ul>
                        {g.axes.map((a) => (
                          <li key={a.id}>
                            <div className="node node-channel">
                              <span className="node-kind">Channel</span>
                              <strong className="mono">ch {a.mcu_channel}</strong>
                            </div>
                            <ul>
                              <li>
                                <div className="node node-axis">
                                  <span className="node-kind">Axis</span>
                                  <strong>
                                    {a.name} <span className="mono muted">· {a.id}</span>
                                  </strong>
                                  <span className="small muted">
                                    {a.kind} · {a.min}…{a.max} {a.unit} · {a.steps_per_unit} steps/{a.unit}
                                  </span>
                                </div>
                                <ul>
                                  <li>
                                    <div className="node node-driver">
                                      <span className="node-kind">Driver</span>
                                      <span className="mono small">{a.actuator}</span>
                                      <span className="pins">
                                        <Pin label="STEP" pin={a.step_pin} />
                                        <Pin label="DIR" pin={a.dir_pin} />
                                        <Pin label="EN" pin={a.enable_pin} />
                                      </span>
                                    </div>
                                  </li>
                                  <li>
                                    <div className={`node node-endstop ${a.endstop_pin ? "" : "node-empty"}`}>
                                      <span className="node-kind">Endstop</span>
                                      {a.endstop_pin ? <Pin label="IN" pin={a.endstop_pin} /> : <span className="small muted">none</span>}
                                    </div>
                                  </li>
                                </ul>
                              </li>
                            </ul>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        )}
      </Panel>
    </div>
  );
}
