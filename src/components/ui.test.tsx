// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api";
import { live, type LiveState } from "../hooks/liveStore";
import type { AxisConfig, RobotState, Session, Telemetry } from "../types/api";
import { EstopButton } from "./Estop";
import { ESTOP_CONFIRM_MS } from "../hooks/status";
import { MotionControl } from "../features/motion/MotionControl";
import { homeAll } from "../hooks/useHomeAll";

beforeAll(() => {
  // jsdom has no modal dialog support.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const setLive = (patch: Partial<LiveState>) =>
  act(() => {
    (live as unknown as { set: (p: Partial<LiveState>) => void }).set(patch);
  });

const telemetry = (state: RobotState): Telemetry => ({
  seq: 1,
  time_ms: 0,
  state,
  fault: null,
  mcu: {} as Telemetry["mcu"],
  axes: [{ id: "j1", homed: true, enabled: true, commanded_position: 0, measured_position: 0, velocity: 0, endstop: false }],
});

const axis: AxisConfig = {
  id: "j1",
  name: "Base",
  kind: "revolute",
  unit: "deg",
  min: -170,
  max: 170,
  max_velocity: 90,
  max_acceleration: 360,
  home_position: -170,
  steps_per_unit: 44.4,
  mcu: "main",
  mcu_channel: 0,
  actuator: "org.motioncore.actuator.step_dir",
  step_pin: "STEP0",
  dir_pin: "DIR0",
  enable_pin: "EN0",
  endstop_pin: "ENDSTOP0",
};

function online(state: RobotState, session: Session | null = null) {
  setLive({
    link: "open",
    apiReachable: true,
    engineConnected: true,
    stale: false,
    session,
    telemetry: telemetry(state),
    config: { name: "bench", profile: "p", mcus: [{ name: "main", board: "virtual", transport: "virtual", watchdog_ms: 500 }], axes: [axis] },
  });
}

let now = 0;
beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("EstopButton", () => {
  it("waits for the engine before claiming the stop succeeded", async () => {
    online("running");
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<EstopButton />);
    expect(screen.getByText(/not a hardware E-stop/i)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "E-STOP" }));
    });
    expect(cmd).toHaveBeenCalledWith("estop", {});
    expect(screen.getByRole("status").textContent).toMatch(/waiting for engine confirmation/i);
    expect(screen.queryByText(/confirmed/i)).toBeNull();

    online("emergency_stopped");
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toBe("E-STOP confirmed by engine");
  });

  it("tells the operator to use the hardware E-stop when the request fails", async () => {
    online("running");
    vi.spyOn(api, "command").mockRejectedValue(new ApiError("engine_unavailable", "engine unavailable", 503));
    render(<EstopButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "E-STOP" }));
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/E-STOP FAILED \(engine_unavailable/);
    expect(alert.textContent).toMatch(/hardware emergency stop/);
  });

  it("reports a missing confirmation after the timeout", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    online("running");
    vi.spyOn(api, "command").mockResolvedValue({});
    render(<EstopButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "E-STOP" }));
    });
    now += ESTOP_CONFIRM_MS + 50;
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/No confirmation from the engine/);
  });

  it("is never disabled, even when disconnected", () => {
    setLive({ link: "closed", apiReachable: false, engineConnected: false, telemetry: null });
    render(<EstopButton />);
    expect((screen.getByRole("button", { name: "E-STOP" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("MotionControl safety", () => {
  it("asks for confirmation before enabling drives", async () => {
    online("disabled");
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<MotionControl />);
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(cmd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cmd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable drives" }));
    });
    expect(cmd).toHaveBeenCalledWith("enable", {});
  });

  it("asks for confirmation before homing", async () => {
    online("ready");
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<MotionControl />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(cmd).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start homing" }));
    });
    expect(cmd).toHaveBeenCalledWith("home", { axis: "j1" });
  });

  it("disables motion for a viewer but keeps Stop", () => {
    online("ready", {
      auth_required: true,
      role: "viewer",
      permissions: { view: true, stop: true, command: false, firmware_build: false, firmware_flash: false },
    });
    render(<MotionControl />);
    const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(btn("Disable").disabled).toBe(true);
    expect(btn("Home").disabled).toBe(true);
    expect(btn("+ 1").disabled).toBe(true);
    expect(btn("Stop").disabled).toBe(false);
    expect(btn("Home all").disabled).toBe(true);
  });

  it("Home all uses the engine's plan when there is one", async () => {
    online("ready");
    const cfg = (live.getState().config as NonNullable<LiveState["config"]>);
    setLive({
      config: { ...cfg, home_all: { groups: [["j1"]], start_pose: "Arm straight up.", from_profile: true }, collision_checking: true },
    });
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<MotionControl />);
    fireEvent.click(screen.getByRole("button", { name: "Home all" }));
    const dialog = screen.getByRole("dialog").textContent ?? "";
    expect(dialog).toMatch(/Start pose: Arm straight up\./);
    expect(dialog).toMatch(/no software can check these paths/);
    expect(dialog).toMatch(/moves that would make the robot collide with itself are refused/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Home 1 axis" }));
    });
    expect(cmd).toHaveBeenCalledWith("home_all", {});
    expect(cmd).not.toHaveBeenCalledWith("home", expect.anything());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await new Promise((r) => setTimeout(r, 300));
    });
    act(() => homeAll.dismiss());
    setLive({ config: cfg });
  });

  it("Home all confirms the order first, then shows progress with Cancel", async () => {
    online("ready");
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<MotionControl />);
    fireEvent.click(screen.getByRole("button", { name: "Home all" }));
    expect(screen.getByRole("dialog").textContent).toMatch(/in this order: j1/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cmd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Home all" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Home 1 axis" }));
    });
    expect(cmd).toHaveBeenCalledWith("home", { axis: "j1" });
    expect(screen.getByText(/\(1\/1\)/).textContent).toMatch(/Homing j1/);
    expect((screen.getByRole("button", { name: "Home all" }) as HTMLButtonElement).disabled).toBe(true);

    // Cancel sends a stop and ends the sequence.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(cmd).toHaveBeenLastCalledWith("stop", {});
    expect(screen.getByText(/Home all cancelled at/)).toBeTruthy();
    act(() => homeAll.dismiss());
  });

  it("disables commands while telemetry is stale", () => {
    online("ready");
    setLive({ stale: true });
    render(<MotionControl />);
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "+ 1" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
