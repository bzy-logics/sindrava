import { describe, expect, it } from "vitest";
import type { AxisConfig, FirmwareJob, FirmwareTarget, McuConfig, RobotConfig } from "../types/api";
import { buildDeviceGraph } from "./composer/graph";
import { buildEligibility, flashEligibility, logTail } from "./firmware/jobs";
import { tabFromHash } from "../app/tabs";

const axis = (id: string, mcu: string, ch: number): AxisConfig => ({
  id,
  name: id,
  kind: "revolute",
  unit: "deg",
  min: -170,
  max: 170,
  max_velocity: 90,
  max_acceleration: 360,
  home_position: null,
  steps_per_unit: 44.444,
  mcu,
  mcu_channel: ch,
  actuator: "org.motioncore.actuator.step_dir",
  step_pin: "STEP0",
  dir_pin: "DIR0",
  enable_pin: "EN0",
  endstop_pin: null,
});

const target = (board: string, is_virtual = false): FirmwareTarget => ({
  board,
  description: "",
  firmware_target: "",
  rust_target: "",
  step_channels: 1,
  max_step_rate: 20000,
  provisional: false,
  is_virtual,
});

const job = (p: Partial<FirmwareJob>): FirmwareJob => ({
  id: "build-1",
  kind: "build",
  state: "succeeded",
  mcu: "main",
  created_unix: 0,
  finished_unix: 1,
  message: "",
  log: "",
  artifact: { board: "blackpill", firmware_version: "0.1.0", build_hash: "dcdfcb82", image_sha256: "7e61", toolchain: "rustc", required_capabilities: [] },
  ...p,
});

describe("buildDeviceGraph", () => {
  it("groups axes by MCU, sorts channels, and surfaces undeclared MCUs", () => {
    const cfg: RobotConfig = {
      name: "r",
      profile: "p",
      mcus: [{ name: "main", board: "virtual", transport: "virtual", watchdog_ms: 500 }],
      axes: [axis("j2", "main", 1), axis("j1", "main", 0), axis("j3", "aux", 0)],
    };
    const g = buildDeviceGraph(cfg);
    expect(g.map((x) => x.name)).toEqual(["main", "aux"]);
    expect(g[0]!.axes.map((a) => a.id)).toEqual(["j1", "j2"]);
    expect(g[1]!.mcu).toBeNull();
  });
});

describe("firmware eligibility", () => {
  const mcu: McuConfig = { name: "main", board: "blackpill", transport: "serial", watchdog_ms: 500 };

  it("disables builds for virtual or unknown boards and while a job runs", () => {
    expect(buildEligibility(mcu, [target("blackpill")], []).ok).toBe(true);
    expect(buildEligibility({ ...mcu, board: "virtual" }, [target("virtual", true)], []).ok).toBe(false);
    expect(buildEligibility(mcu, [], []).ok).toBe(false);
    expect(buildEligibility(mcu, [target("blackpill")], [job({ state: "running" })]).ok).toBe(false);
  });

  it("only offers flash for succeeded builds with an artifact", () => {
    const t = [target("blackpill")];
    expect(flashEligibility(job({}), t, []).ok).toBe(true);
    expect(flashEligibility(job({ state: "failed" }), t, []).ok).toBe(false);
    expect(flashEligibility(job({ kind: "flash" }), t, []).ok).toBe(false);
    expect(flashEligibility(job({ artifact: null }), t, []).ok).toBe(false);
  });

  it("logTail keeps the last lines", () => {
    expect(logTail("a\nb\nc\nd\n\n", 2)).toBe("c\nd");
  });
});

describe("tabFromHash", () => {
  it("maps ids, legacy aliases and unknown hashes", () => {
    expect(tabFromHash("#firmware")).toBe("firmware");
    expect(tabFromHash("#control")).toBe("motion");
    expect(tabFromHash("#config")).toBe("robot");
    expect(tabFromHash("")).toBe("dashboard");
    expect(tabFromHash("#nope")).toBe("dashboard");
  });
});
