import { useSyncExternalStore } from "react";
import { auth, type AuthState } from "../api";
import type { RobotState, Telemetry } from "../types/api";
import { live, type LiveState } from "./liveStore";

/** Whole live state (link, engine, info, telemetry, config, plugins, logs). */
export function useEngine(): LiveState {
  return useSyncExternalStore(live.subscribe, live.getState);
}

export interface TelemetryView {
  telemetry: Telemetry | null;
  /** True when API, engine and telemetry are all available. */
  online: boolean;
  /** Effective state: "disconnected" whenever not online. */
  state: RobotState;
}

export function useTelemetry(): TelemetryView {
  const s = useEngine();
  const t = s.telemetry;
  const online = s.apiReachable && s.engineConnected && t !== null;
  return { telemetry: t, online, state: online ? t.state : "disconnected" };
}

export function useAuth(): AuthState {
  return useSyncExternalStore(auth.subscribe, auth.getState);
}
