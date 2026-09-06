import { useAuth, useEngine } from "../hooks/useEngine";
import { live } from "../hooks/liveStore";
import { TokenForm } from "./Settings";

/** Auth prompt: shown after any 401, or when the server requires a token and none is set. */
export function AuthBanner() {
  const { info } = useEngine();
  const a = useAuth();
  const missing = info?.auth_required === true && a.token === "";
  if (!a.rejected && !missing) return null;
  return (
    <div className="banner banner-auth" role="alert">
      <strong>{a.rejected ? "Not authorized." : "API token required."}</strong>
      <span>{a.rejected && a.token ? "The server rejected the stored API token." : "This server requires an API token."}</span>
      <TokenForm compact />
    </div>
  );
}

export function ConnectionBanner() {
  const s = useEngine();
  const a = useAuth();
  // With a missing/rejected token the WS upgrade fails but the API is up; the auth banner covers that case.
  const authBlocked = a.rejected || (s.info?.auth_required === true && a.token === "");
  if (!s.apiReachable || (s.link === "closed" && !authBlocked)) {
    return (
      <div className="banner banner-err" role="alert">
        <strong>API unreachable.</strong>
        <span>
          {s.reconnectIn !== null ? `Reconnecting in ~${s.reconnectIn}s…` : "Reconnecting…"} Commands and live data are unavailable.
        </span>
        <button className="btn btn-small" onClick={() => live.retry()}>
          Retry now
        </button>
      </div>
    );
  }
  if (!s.engineConnected) {
    return (
      <div className="banner banner-warn" role="alert">
        <strong>Engine disconnected.</strong>
        <span>The API is up but the motion engine is not connected. Displayed values are stale.</span>
      </div>
    );
  }
  return null;
}
