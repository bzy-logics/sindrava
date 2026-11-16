// Pure connection/safety status logic, shared by the store, the UI and tests.

import type { Permissions, RobotState, Session, Telemetry } from "../types/api";
import type { WsLink } from "../api/ws";

/** Telemetry older than this (while the link is up) is stale. The engine sends ~20 Hz. */
export const STALE_AFTER_MS = 1500;

/**
 * What the operator should understand about the data on screen:
 * - connected:    live data from a connected engine
 * - reconnecting: the API WebSocket is down and being retried
 * - disconnected: API unreachable, or the engine is not connected to the API
 * - stale:        connected, but telemetry stopped arriving
 * - faulted:      live data, robot faulted or emergency-stopped
 */
export type ConnectionStatus = "connected" | "reconnecting" | "disconnected" | "stale" | "faulted";

export interface StatusInput {
  apiReachable: boolean;
  link: WsLink;
  engineConnected: boolean;
  stale: boolean;
  telemetry: Telemetry | null;
}

export function connectionStatus(s: StatusInput): ConnectionStatus {
  if (!s.apiReachable) return "disconnected";
  if (s.link !== "open") return "reconnecting";
  if (!s.engineConnected || !s.telemetry) return "disconnected";
  if (s.stale) return "stale";
  const st = s.telemetry.state;
  if (s.telemetry.fault || st === "faulted" || st === "emergency_stopped") return "faulted";
  return "connected";
}

/** Live data usable for commanding: everything up and fresh (a faulted robot is still "online"). */
export function isOnline(status: ConnectionStatus): boolean {
  return status === "connected" || status === "faulted";
}

/** Whether telemetry received at `lastAt` is stale at `now`. */
export function isStale(lastAt: number | null, now: number): boolean {
  return lastAt !== null && now - lastAt > STALE_AFTER_MS;
}

/** Permissions to assume when the server has no session endpoint (older ratavyr): show everything, the server enforces. */
export const UNKNOWN_PERMISSIONS: Permissions = { view: true, stop: true, command: true, firmware_build: true, firmware_flash: true };

export function permissionsOf(session: Session | null): Permissions {
  return session?.permissions ?? UNKNOWN_PERMISSIONS;
}

// ---------------------------------------------------------------- emergency stop

/** How long the engine may take to report emergency_stopped after accepting the command. */
export const ESTOP_CONFIRM_MS = 2000;

/**
 * Lifecycle of a software E-stop request, as shown to the operator. It is
 * only "confirmed" once engine telemetry reports emergency_stopped; a 200 from
 * the API only means the engine accepted the command.
 */
export type EstopPhase =
  | { kind: "idle" }
  | { kind: "sending"; at: number }
  | { kind: "awaiting"; at: number }
  | { kind: "confirmed"; at: number }
  | { kind: "failed"; at: number; reason: string }
  | { kind: "unconfirmed"; at: number };

/** Advance an in-flight E-stop with the latest engine state and time. */
export function evaluateEstop(phase: EstopPhase, state: RobotState | null, online: boolean, now: number): EstopPhase {
  if (phase.kind !== "awaiting" && phase.kind !== "sending") return phase;
  if (online && state === "emergency_stopped") return { kind: "confirmed", at: now };
  if (phase.kind === "awaiting" && now - phase.at > ESTOP_CONFIRM_MS) return { kind: "unconfirmed", at: now };
  return phase;
}
