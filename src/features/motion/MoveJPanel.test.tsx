// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { live, type LiveState } from "../../hooks/liveStore";
import type { AxisConfig, AxisTelemetry, RobotState } from "../../types/api";
import { MoveJPanel } from "./MoveJPanel";
import { MotionControl } from "./MotionControl";
import { describeContact, jointMoveBlocker } from "./jointMove";

const ax = (id: string, min: number, max: number, vmax = 60): AxisConfig =>
  ({ id, name: id.toUpperCase(), kind: "revolute", unit: "deg", min, max, max_velocity: vmax, max_acceleration: 100, home_position: min, geometry: null }) as AxisConfig;
const AXES = [ax("j1", -170, 170), ax("j2", -73, 90, 30), ax("j3", 35, 180)];
const tel = (id: string, homed = true, pos = 0): AxisTelemetry => ({ id, homed, enabled: true, commanded_position: pos, measured_position: pos, velocity: 0, endstop: false });

function setLive({ state = "ready" as RobotState, api_version = "0.2.0", unhomed = [] as string[] } = {}) {
  act(() => {
    (live as unknown as { set: (p: Partial<LiveState>) => void }).set({
      link: "open",
      apiReachable: true,
      engineConnected: true,
      stale: false,
      session: null,
      info: { engine: { api_version } } as LiveState["info"],
      config: { name: "arm", profile: "p", mcus: [], axes: AXES } as unknown as LiveState["config"],
      telemetry: { seq: 1, time_ms: 0, state, fault: null, mcu: {} as never, axes: [tel("j1", !unhomed.includes("j1")), tel("j2", !unhomed.includes("j2")), tel("j3", true, 90)] },
    });
  });
}

const type = (id: string, v: string) => fireEvent.change(screen.getByLabelText(`Target for ${id} (deg)`), { target: { value: v } });
const moveBtn = () => screen.getByRole("button", { name: /^Move/ }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MoveJPanel", () => {
  it("sends one move_j for several joints, at the chosen speed", async () => {
    setLive();
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<MoveJPanel />);
    type("j1", "30");
    type("j2", "-10.5");
    type("j3", "90"); // where it already is: holds
    expect(moveBtn().textContent).toBe("Move 2 joints together");
    await act(async () => {
      fireEvent.click(moveBtn());
    });
    expect(cmd).toHaveBeenCalledWith("move_j", { targets: { j1: 30, j2: -10.5 }, speed_scale: 0.5 });
    // Targets are cleared once the engine accepted the move.
    expect((screen.getByLabelText("Target for j1 (deg)") as HTMLInputElement).value).toBe("");

    type("j1", "-20");
    type("j2", "5");
    fireEvent.click(screen.getByRole("radio", { name: "100%" }));
    await act(async () => {
      fireEvent.click(moveBtn());
    });
    expect(cmd).toHaveBeenLastCalledWith("move_j", { targets: { j1: -20, j2: 5 } });
  });

  it("sends a single joint as move_to with a scaled velocity", async () => {
    setLive();
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<MoveJPanel />);
    type("j2", "45");
    await act(async () => {
      fireEvent.click(moveBtn());
    });
    expect(cmd).toHaveBeenCalledWith("move_to", { axis: "j2", position: 45, velocity: 15 });
  });

  it("explains why a move cannot be sent", () => {
    setLive({ unhomed: ["j2"] });
    render(<MoveJPanel />);
    type("j1", "30");
    type("j2", "10");
    expect(moveBtn().disabled).toBe(true);
    expect(screen.getByText("Home j2 first: absolute moves need homed axes.")).toBeTruthy();
    cleanup();

    setLive();
    render(<MoveJPanel />);
    type("j1", "30");
    type("j3", "20");
    expect(screen.getByText("Target of j3 outside the soft limits [35, 180] deg.")).toBeTruthy();
    type("j3", "abc");
    expect(screen.getByText("Not a number: j3.")).toBeTruthy();
    expect(moveBtn().disabled).toBe(true);
    cleanup();

    setLive({ state: "running" });
    render(<MoveJPanel />);
    type("j1", "30");
    expect(screen.getByText(/it must be ready/)).toBeTruthy();
  });

  it("is offered only by engines with API 0.2 or newer", () => {
    setLive({ api_version: "0.1.4" });
    render(<MotionControl />);
    expect(screen.queryByRole("region", { name: "Coordinated joint move" })).toBeNull();
    expect(screen.getByText(/Coordinated joint moves need engine API 0.2 or newer/)).toBeTruthy();
    cleanup();
    setLive();
    render(<MotionControl />);
    expect(screen.getByRole("region", { name: "Coordinated joint move" })).toBeTruthy();
  });
});

describe("jointMoveBlocker", () => {
  const base = { axes: AXES, online: true, canCommand: true, state: "ready" as RobotState, apiVersion: "0.2.0", contact: null };
  const t = { seq: 1, time_ms: 0, state: "ready" as RobotState, fault: null, mcu: {} as never, axes: [tel("j1"), tel("j2"), tel("j3", true, 90)] };

  it("needs engine API 0.2 for several joints, not for one", () => {
    expect(jointMoveBlocker({ ...base, telemetry: t, targets: { j1: 1, j2: 2 }, apiVersion: "0.1.4" })).toMatch(/needs engine API 0.2/);
    expect(jointMoveBlocker({ ...base, telemetry: t, targets: { j1: 1 }, apiVersion: "0.1.4" })).toBeNull();
    expect(jointMoveBlocker({ ...base, telemetry: t, targets: { j1: 1, j2: 2 } })).toBeNull();
  });

  it("names every moving joint where a collision would happen", () => {
    const c = { a: "j1", b: "j6", gap: -3, at: { j1: 12.04, j2: 30.5, j3: 90 } };
    expect(describeContact(c, { j1: 40, j2: 60 }, AXES)).toBe("Would collide: links of j1 and j6 at j1 12.0, j2 30.5; the engine refuses this move.");
    expect(describeContact({ ...c, b: "floor" }, { j2: 60 }, AXES)).toBe("Would hit the floor (link of j1) when j2 reaches 30.5 deg; the engine refuses this move.");
    expect(jointMoveBlocker({ ...base, telemetry: t, targets: { j1: 40, j2: 60 }, contact: c })).toMatch(/^Would collide/);
  });
});

describe("apiAtLeast", () => {
  it("compares major.minor", async () => {
    const { apiAtLeast } = await import("./axes");
    expect(apiAtLeast("0.2.0", 0, 2)).toBe(true);
    expect(apiAtLeast("0.2.7", 0, 2)).toBe(true);
    expect(apiAtLeast("0.1.4", 0, 2)).toBe(false);
    expect(apiAtLeast("0.10.0", 0, 2)).toBe(true);
    expect(apiAtLeast(undefined, 0, 2)).toBe(false);
    expect(apiAtLeast("garbage", 0, 2)).toBe(false);
  });
});
