// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { live, type LiveState } from "../../hooks/liveStore";
import type { AxisConfig, AxisTelemetry, RobotState, Session } from "../../types/api";
import { JointPanel } from "./JointPanel";

const cfg: AxisConfig = {
  id: "j2",
  name: "Shoulder",
  kind: "revolute",
  unit: "deg",
  min: -73,
  max: 90,
  max_velocity: 60,
  max_acceleration: 100,
  home_position: -73,
  steps_per_unit: 266.7,
  mcu: "main",
  mcu_channel: 1,
  actuator: "a",
  step_pin: "S",
  dir_pin: "D",
  enable_pin: "E",
  endstop_pin: "ES",
  geometry: null,
};

const tel = (homed: boolean, id = "j2"): AxisTelemetry => ({ id, homed, enabled: true, commanded_position: 10, measured_position: 10, velocity: 0, endstop: false });

function setLive(state: RobotState, session: Session | null = null) {
  act(() => {
    (live as unknown as { set: (p: Partial<LiveState>) => void }).set({
      link: "open",
      apiReachable: true,
      engineConnected: true,
      stale: false,
      session,
      telemetry: { seq: 1, time_ms: 0, state, fault: null, mcu: {} as never, axes: [tel(true)] },
    });
  });
}

/** Holds the preview like the viewer does. */
function Harness({ homed = true, initial = null as number | null }) {
  const [preview, setPreview] = useState<number | null>(initial);
  return <JointPanel id="j2" cfg={cfg} tel={tel(homed)} preview={preview} onPreview={setPreview} onClose={() => {}} />;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("JointPanel", () => {
  it("previews with the slider and sends only on Move", async () => {
    setLive("ready");
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<Harness />);
    expect(button(/^Move/).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Preview target for j2"), { target: { value: "45" } });
    expect(cmd).not.toHaveBeenCalled();
    expect(screen.getByText("45.00 deg")).toBeTruthy();

    await act(async () => {
      fireEvent.click(button("Move to 45.00"));
    });
    expect(cmd).toHaveBeenCalledWith("move_to", { axis: "j2", position: 45 });
    // Preview is cleared once the engine accepted the move.
    expect(button(/^Move/).disabled).toBe(true);
  });

  it("accepts a typed target", () => {
    setLive("ready");
    render(<Harness />);
    const input = screen.getByLabelText("Target value for j2");
    fireEvent.change(input, { target: { value: "-12.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(button("Move to -12.50").disabled).toBe(false);
  });

  it("refuses targets outside the soft limits", () => {
    setLive("ready");
    render(<Harness initial={120} />);
    expect(button(/^Move/).disabled).toBe(true);
    expect(screen.getByText(/outside the soft limits \[-73, 90\]/)).toBeTruthy();
  });

  it("needs a homed axis for absolute moves, but still jogs", async () => {
    setLive("ready");
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    render(<Harness homed={false} initial={30} />);
    expect(button(/^Move/).disabled).toBe(true);
    expect(screen.getByText(/Home this axis first/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "10" }));
    await act(async () => {
      fireEvent.click(button("+ 10"));
    });
    expect(cmd).toHaveBeenCalledWith("jog", { axis: "j2", delta: 10 });
  });

  it("disables commands for a viewer and while not ready", () => {
    setLive("ready", {
      auth_required: true,
      role: "viewer",
      permissions: { view: true, stop: true, command: false, firmware_build: false, firmware_flash: false },
    });
    render(<Harness initial={30} />);
    expect(button(/^Move/).disabled).toBe(true);
    expect(button("+ 1").disabled).toBe(true);
    expect(screen.getByText("Requires the operator role.")).toBeTruthy();
    cleanup();

    setLive("running");
    render(<Harness initial={30} />);
    expect(button(/^Move/).disabled).toBe(true);
    expect(screen.getByText(/it must be ready/)).toBeTruthy();
  });

  it("clears the preview", () => {
    setLive("ready");
    render(<Harness initial={30} />);
    fireEvent.click(button("Clear"));
    expect(button(/^Move/).disabled).toBe(true);
    expect(button("Clear").disabled).toBe(true);
  });
});

describe("JointPanel collision warning", () => {
  it("blocks Move and explains the engine's refusal", () => {
    setLive("ready");
    function H() {
      const [preview, setPreview] = useState<number | null>(60);
      return (
        <JointPanel
          id="j2"
          cfg={cfg}
          tel={tel(true)}
          preview={preview}
          onPreview={setPreview}
          onClose={() => {}}
          contact={{ a: "j2", b: "j6", gap: -4.2, at: { j2: 37.5 } }}
        />
      );
    }
    render(<H />);
    expect(button(/^Move/).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/Would collide: links of j2 and j6 when j2 reaches 37\.5 deg; the engine refuses this move/);
  });
});

describe("JointPanel with several previewed joints", () => {
  it("moves every previewed joint together with one move_j", async () => {
    setLive("ready");
    act(() => {
      (live as unknown as { set: (p: Partial<LiveState>) => void }).set({
        info: { engine: { api_version: "0.2.0" } } as LiveState["info"],
        telemetry: { seq: 2, time_ms: 0, state: "ready", fault: null, mcu: {} as never, axes: [tel(true, "j1"), tel(true)] },
      });
    });
    const cmd = vi.spyOn(api, "command").mockResolvedValue({});
    const cleared = vi.fn();
    function H() {
      const [preview, setPreview] = useState<number | null>(45);
      return <JointPanel id="j2" cfg={cfg} tel={tel(true)} preview={preview} onPreview={setPreview} onClose={() => {}} others={{ j1: 30 }} onClearAll={cleared} />;
    }
    render(<H />);
    expect(screen.getByText("j1 → 30.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "50%" }));
    await act(async () => {
      fireEvent.click(button("Move 2 joints together"));
    });
    expect(cmd).toHaveBeenCalledWith("move_j", { targets: { j1: 30, j2: 45 }, speed_scale: 0.5 });
    expect(cleared).toHaveBeenCalled();
  });
});
