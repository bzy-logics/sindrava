import type { AxisConfig, AxisTelemetry, RobotState } from "../../types/api";

export interface MergedAxis {
  id: string;
  cfg: AxisConfig | null;
  tel: AxisTelemetry | null;
}

/** Join configured axes with telemetry by id (config order first, then unknown telemetry axes). */
export function mergeAxes(cfg: AxisConfig[] | null, tel: AxisTelemetry[]): MergedAxis[] {
  const out: MergedAxis[] = (cfg ?? []).map((c) => ({ id: c.id, cfg: c, tel: tel.find((a) => a.id === c.id) ?? null }));
  for (const a of tel) if (!out.some((m) => m.id === a.id)) out.push({ id: a.id, cfg: null, tel: a });
  return out;
}

/** True when the engine's API version (e.g. "0.2.0") is at least major.minor. */
export function apiAtLeast(version: string | null | undefined, major: number, minor: number): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a > major || (a === major && b >= minor);
}

/** Which commands the UI offers in each robot state (the engine still validates). E-STOP is always allowed. */
export const allowed = {
  enable: (s: RobotState) => s === "disabled",
  disable: (s: RobotState) => s === "ready" || s === "homing" || s === "running",
  stop: (s: RobotState) => s === "ready" || s === "homing" || s === "running",
  jog: (s: RobotState) => s === "ready",
  home: (s: RobotState) => s === "ready",
  move_to: (s: RobotState) => s === "ready",
  move_j: (s: RobotState) => s === "ready",
  reset_fault: (s: RobotState) => s === "faulted" || s === "emergency_stopped",
};
