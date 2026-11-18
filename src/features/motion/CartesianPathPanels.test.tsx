// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { live, type LiveState } from "../../hooks/liveStore";
import type { AxisConfig, RobotState, Telemetry, ToolPose } from "../../types/api";
import { CartesianPanel } from "./CartesianPanel";
import { PathPanel } from "./PathPanel";
import { MotionControl } from "./MotionControl";

const IDS = ["j1", "j2", "j3", "j4", "j5", "j6"];
const AXES = IDS.map((id) => ({ id, name: id.toUpperCase(), kind: "revolute", unit: "deg", min: -170, max: 170, max_velocity: 60, max_acceleration: 100, home_position: -170, geometry: null }) as unknown as AxisConfig);
const TOOL: ToolPose = { position_mm: [89.41, 0, 146.74], rotation_deg: [0, 90, 0] };

function telemetry(q: number[], { homed = true, tool = TOOL as ToolPose | null, state = "ready" as RobotState } = {}): Telemetry {
  return {
    seq: 1,
    time_ms: 0,
    state,
    fault: null,
    mcu: {} as never,
    axes: IDS.map((id, i) => ({ id, homed, enabled: true, commanded_position: q[i]!, measured_position: q[i]!, velocity: 0, endstop: false })),
    tool,
  };
}

function setLive(t: Telemetry, api_version = "0.3.0") {
  act(() => {
    (live as unknown as { set: (p: Partial<LiveState>) => void }).set({
      link: "open",
      apiReachable: true,
      engineConnected: true,
      stale: false,
      session: null,
      info: { engine: { api_version } } as LiveState["info"],
      config: { name: "arm", profile: "p", mcus: [], axes: AXES } as unknown as LiveState["config"],
      telemetry: t,
    });
  });
}

const Q0 = [0, -73, 180, 0, 0, 0];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CartesianPanel", () => {
  it("is hidden without a tool pose (no serial chain)", () => {
    setLive(telemetry(Q0, { tool: null }));
    render(<CartesianPanel />);
    expect(screen.queryByRole("region", { name: "Cartesian move" })).toBeNull();
  });

  it("shows the tool pose and sends a straight-line move, keeping the orientation", async () => {
    setLive(telemetry(Q0));
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<CartesianPanel />);
    expect(screen.getByLabelText("Tool pose").textContent).toMatch(/x 89\.41 y 0\.00 z 146\.74 mm/);
    const btn = screen.getByRole("button", { name: "Move in a line" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Fill current" }));
    fireEvent.change(screen.getByLabelText("Target Y (mm)"), { target: { value: "120" } });
    // Clearing the orientation keeps it.
    for (const k of ["roll", "pitch", "yaw"]) fireEvent.change(screen.getByLabelText(`Target ${k} (deg)`), { target: { value: "" } });
    fireEvent.click(screen.getByRole("radio", { name: "25 mm/s" }));
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(cmd).toHaveBeenCalledWith("move_l", { position_mm: [89.41, 120, 146.74], speed_mm_s: 25 });
  });

  it("sends a target orientation and refuses incomplete or unsafe requests", async () => {
    setLive(telemetry(Q0));
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<CartesianPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fill current" }));
    fireEvent.change(screen.getByLabelText("Target yaw (deg)"), { target: { value: "30" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move in a line" }));
    });
    expect(cmd).toHaveBeenCalledWith("move_l", { position_mm: [89.41, 0, 146.74], rotation_deg: [0, 90, 30], speed_mm_s: 50 });

    fireEvent.change(screen.getByLabelText("Target pitch (deg)"), { target: { value: "" } });
    expect(screen.getByText(/Enter roll, pitch and yaw/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Target X (mm)"), { target: { value: "abc" } });
    expect(screen.getByText("Enter X, Y and Z.")).toBeTruthy();
    cleanup();

    setLive(telemetry(Q0, { homed: false }));
    render(<CartesianPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Fill current" }));
    expect(screen.getByText(/Home every axis first/)).toBeTruthy();
  });
});

describe("PathPanel", () => {
  it("records poses as waypoints and runs them as one blended path", async () => {
    setLive(telemetry(Q0));
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<PathPanel />);
    const runBtn = () => screen.getByRole("button", { name: /^Run path/ }) as HTMLButtonElement;
    expect(runBtn().disabled).toBe(true);
    setLive(telemetry([0, 0, 90, 0, 0, 0]));
    fireEvent.click(screen.getByRole("button", { name: "Add current pose" }));
    setLive(telemetry([60, 30, 120, 90, -60, 180]));
    fireEvent.click(screen.getByRole("button", { name: "Add current pose" }));
    setLive(telemetry([1, 2, 3, 4, 5, 6]));
    fireEvent.click(screen.getByRole("button", { name: "Add current pose" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove waypoint 3" }));
    expect(runBtn().textContent).toBe("Run path (2 waypoints)");
    await act(async () => {
      fireEvent.click(runBtn());
    });
    expect(cmd).toHaveBeenCalledWith("move_j_path", {
      waypoints: [
        { j1: 0, j2: 0, j3: 90, j4: 0, j5: 0, j6: 0 },
        { j1: 60, j2: 30, j3: 120, j4: 90, j5: -60, j6: 180 },
      ],
      speed_scale: 0.5,
    });
  });

  it("needs homed axes and a ready robot", () => {
    setLive(telemetry(Q0, { homed: false }));
    render(<PathPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Add current pose" }));
    expect(screen.getByText(/Home j1, j2, j3, j4, j5, j6 first/)).toBeTruthy();
    cleanup();
    setLive(telemetry(Q0, { state: "running" }));
    render(<PathPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Add current pose" }));
    expect(screen.getByText(/it must be ready/)).toBeTruthy();
  });
});

describe("Motion screen", () => {
  it("offers Cartesian moves and paths only with engine API 0.3 or newer", () => {
    setLive(telemetry(Q0), "0.2.0");
    render(<MotionControl />);
    expect(screen.getByRole("region", { name: "Coordinated joint move" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Cartesian move" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Joint path" })).toBeNull();
    cleanup();
    setLive(telemetry(Q0), "0.3.0");
    render(<MotionControl />);
    expect(screen.getByRole("region", { name: "Cartesian move" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Joint path" })).toBeTruthy();
  });
});
