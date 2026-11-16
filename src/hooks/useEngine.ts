import { useSyncExternalStore } from "react";
import { auth, type AuthState } from "../api";
import type { Permissions, RobotState, Telemetry } from "../types/api";
import { live, type LiveState } from "./liveStore";
import { connectionStatus, isOnline, permissionsOf, type ConnectionStatus } from "./status";

/** Whole live state (link, engine, info, telemetry, config, plugins, logs). */
export function useEngine(): LiveState {
  return useSyncExternalStore(live.subscribe, live.getState);
}

export interface TelemetryView {
  telemetry: Telemetry | null;
  /** True when API, engine and fresh telemetry are all available. Stale data is not online. */
  online: boolean;
  /** Effective state: "disconnected" whenever not online. */
  state: RobotState;
  status: ConnectionStatus;
}

export function useTelemetry(): TelemetryView {
  const s = useEngine();
  const t = s.telemetry;
  const status = connectionStatus(s);
  const online = isOnline(status) && t !== null;
  return { telemetry: t, online, state: online && t ? t.state : "disconnected", status };
}

/** What the current token may do (all true when the server does not say). */
export function usePermissions(): Permissions {
  return permissionsOf(useEngine().session);
}

export function useAuth(): AuthState {
  return useSyncExternalStore(auth.subscribe, auth.getState);
}
