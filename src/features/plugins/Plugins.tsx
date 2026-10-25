import { live } from "../../hooks/liveStore";
import { useEngine } from "../../hooks/useEngine";
import { Chip, Chips, Empty, Panel, type Tone } from "../../components/common";

const STATE_TONE: Record<string, Tone | "dim" | undefined> = {
  initialized: "info",
  active: "ok",
  failed: "err",
  deactivated: "dim",
};

export function Plugins() {
  const { plugins } = useEngine();
  return (
    <Panel
      title="Plugins"
      actions={
        <button className="btn btn-small" onClick={() => live.refreshStatic()}>
          Refresh
        </button>
      }
    >
      {plugins === null ? (
        <Empty>Plugin list unavailable (engine not connected or not authorized?).</Empty>
      ) : plugins.length === 0 ? (
        <Empty>No plugins loaded.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Plugin</th>
                <th>Version</th>
                <th>API</th>
                <th>Kind</th>
                <th>State</th>
                <th>Provides</th>
                <th>Requires</th>
                <th>Permissions</th>
              </tr>
            </thead>
            <tbody>
              {plugins.map((p) => (
                <tr key={p.id}>
                  <td data-label="Plugin">
                    <div className="mono">{p.id}</div>
                    {p.description && <div className="muted small">{p.description}</div>}
                  </td>
                  <td className="mono" data-label="Version">
                    {p.version}
                  </td>
                  <td className="mono" data-label="API">
                    {p.api_version}
                  </td>
                  <td data-label="Kind">{p.kind}</td>
                  <td data-label="State">
                    <Chip tone={STATE_TONE[p.state]}>{p.state}</Chip>
                    {p.error && <div className="err-text small">{p.error}</div>}
                  </td>
                  <td data-label="Provides">
                    <Chips items={p.provides} />
                  </td>
                  <td data-label="Requires">
                    <Chips items={p.requires} />
                  </td>
                  <td data-label="Permissions">
                    <Chips items={p.permissions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
