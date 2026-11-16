import { useState, type FormEvent } from "react";
import { auth } from "../api";
import { useAuth, useEngine } from "../hooks/useEngine";
import { Panel, Row, txt } from "../components/common";
import { useToast } from "../components/Toasts";

/** Token entry; kept for this tab (or remembered on this device) and used for REST (Bearer) and WebSocket tickets. */
export function TokenForm({ compact = false }: { compact?: boolean }) {
  const a = useAuth();
  const toast = useToast();
  const [value, setValue] = useState(a.token);
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(a.remembered);

  const save = (e: FormEvent) => {
    e.preventDefault();
    auth.setToken(value, remember);
    toast("ok", value.trim() ? "API token saved" : "API token cleared");
  };

  return (
    <form className={`token-form ${compact ? "token-form-compact" : ""}`} onSubmit={save}>
      <input
        type={show ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        placeholder="API token"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="API token"
      />
      <button type="button" className="btn btn-small" onClick={() => setShow((x) => !x)}>
        {show ? "Hide" : "Show"}
      </button>
      <label className="check small" title="Keep the token in this browser's localStorage. Otherwise it is forgotten when the tab closes.">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        remember on this device
      </label>
      <button type="submit" className="btn btn-primary btn-small">
        Save
      </button>
      {!compact && a.token && (
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            setValue("");
            auth.setToken("");
            toast("ok", "API token cleared");
          }}
        >
          Clear
        </button>
      )}
    </form>
  );
}

export function Settings() {
  const { info, session } = useEngine();
  const a = useAuth();
  return (
    <div className="stack">
      <Panel title="API token">
        <p className="small">
          Needed only when the server is started with API tokens (viewer, operator or admin). Sent as <code>Authorization: Bearer …</code>; the
          live connection uses a single-use ticket, so the token never appears in a URL. Kept for this tab only unless you choose to remember it.
        </p>
        <dl className="kv kv-inline small">
          <dt>Server requires auth</dt>
          <dd>{info === null ? "unknown" : info.auth_required ? "yes" : "no"}</dd>
          <dt>Token stored</dt>
          <dd>{a.token ? (a.remembered ? "yes (this device)" : "yes (this tab)") : "no"}</dd>
          <dt>Role</dt>
          <dd>{session ? session.role : "unknown"}</dd>
          <dt>Last result</dt>
          <dd className={a.rejected ? "err-text" : undefined}>{a.rejected ? "rejected (401)" : "ok"}</dd>
        </dl>
        <TokenForm />
      </Panel>
      <Panel title="Server">
        <dl className="kv">
          <Row k="Server version" v={txt(info?.server_version)} />
          <Row k="Engine version" v={txt(info?.engine?.engine_version)} />
          <Row k="Engine API" v={txt(info?.engine?.api_version)} />
          <Row k="MCU protocol" v={info?.engine ? `v${info.engine.mcu_protocol_version}` : "—"} />
          <Row k="Plugin API" v={txt(info?.engine?.plugin_api_version)} />
          <Row
            k="Fault injection"
            v={info?.engine ? (info.engine.fault_injection_enabled ? "enabled" : "disabled") : "—"}
            warn={info?.engine?.fault_injection_enabled === true}
          />
        </dl>
      </Panel>
    </div>
  );
}
