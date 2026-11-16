import { describe, expect, it } from "vitest";
import type { Session, Telemetry } from "../types/api";
import {
  ESTOP_CONFIRM_MS,
  STALE_AFTER_MS,
  UNKNOWN_PERMISSIONS,
  connectionStatus,
  evaluateEstop,
  isOnline,
  isStale,
  permissionsOf,
  type StatusInput,
} from "./status";

const tel = (state: Telemetry["state"], fault: Telemetry["fault"] = null): Telemetry =>
  ({ seq: 1, time_ms: 0, state, fault, mcu: {} as Telemetry["mcu"], axes: [] }) as Telemetry;

const up: StatusInput = { apiReachable: true, link: "open", engineConnected: true, stale: false, telemetry: tel("ready") };

describe("connectionStatus", () => {
  it("is connected only when everything is up and fresh", () => {
    expect(connectionStatus(up)).toBe("connected");
  });
  it("distinguishes the failure layers", () => {
    expect(connectionStatus({ ...up, apiReachable: false })).toBe("disconnected");
    expect(connectionStatus({ ...up, link: "closed" })).toBe("reconnecting");
    expect(connectionStatus({ ...up, link: "connecting" })).toBe("reconnecting");
    expect(connectionStatus({ ...up, engineConnected: false })).toBe("disconnected");
    expect(connectionStatus({ ...up, telemetry: null })).toBe("disconnected");
    expect(connectionStatus({ ...up, stale: true })).toBe("stale");
  });
  it("reports faults and emergency stops", () => {
    expect(connectionStatus({ ...up, telemetry: tel("faulted") })).toBe("faulted");
    expect(connectionStatus({ ...up, telemetry: tel("emergency_stopped") })).toBe("faulted");
    expect(connectionStatus({ ...up, telemetry: tel("disabled", { code: "limit_hit", message: "", axis: "j1" }) })).toBe("faulted");
  });
  it("stale beats faulted: old fault data is not live", () => {
    expect(connectionStatus({ ...up, stale: true, telemetry: tel("faulted") })).toBe("stale");
  });
  it("only connected and faulted count as online", () => {
    expect(isOnline("connected")).toBe(true);
    expect(isOnline("faulted")).toBe(true);
    for (const s of ["stale", "reconnecting", "disconnected"] as const) expect(isOnline(s)).toBe(false);
  });
});

describe("isStale", () => {
  it("uses the threshold", () => {
    expect(isStale(null, 1e9)).toBe(false);
    expect(isStale(1000, 1000 + STALE_AFTER_MS)).toBe(false);
    expect(isStale(1000, 1001 + STALE_AFTER_MS)).toBe(true);
  });
});

describe("evaluateEstop", () => {
  it("confirms only on engine-reported emergency_stopped", () => {
    const awaiting = { kind: "awaiting", at: 0 } as const;
    expect(evaluateEstop(awaiting, "ready", true, 100).kind).toBe("awaiting");
    expect(evaluateEstop(awaiting, "emergency_stopped", true, 100).kind).toBe("confirmed");
    // A stale/offline view must not confirm, even if the last frame said so.
    expect(evaluateEstop(awaiting, "emergency_stopped", false, 100).kind).toBe("awaiting");
  });
  it("times out without confirmation", () => {
    const awaiting = { kind: "awaiting", at: 0 } as const;
    expect(evaluateEstop(awaiting, "ready", true, ESTOP_CONFIRM_MS).kind).toBe("awaiting");
    expect(evaluateEstop(awaiting, "ready", true, ESTOP_CONFIRM_MS + 1).kind).toBe("unconfirmed");
  });
  it("does not time out while the request is still being sent", () => {
    expect(evaluateEstop({ kind: "sending", at: 0 }, "ready", true, 60_000).kind).toBe("sending");
  });
  it("leaves final phases alone", () => {
    for (const p of [{ kind: "idle" }, { kind: "failed", at: 0, reason: "x" }, { kind: "unconfirmed", at: 0 }] as const) {
      expect(evaluateEstop(p, "emergency_stopped", true, 1)).toBe(p);
    }
  });
});

describe("permissionsOf", () => {
  it("uses the session, or allows everything when unknown (server enforces)", () => {
    const s: Session = {
      auth_required: true,
      role: "viewer",
      permissions: { view: true, stop: true, command: false, firmware_build: false, firmware_flash: false },
    };
    expect(permissionsOf(s).command).toBe(false);
    expect(permissionsOf(null)).toEqual(UNKNOWN_PERMISSIONS);
  });
});
