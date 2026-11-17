import { describe, expect, it } from "vitest";
import type { AxisConfig, Telemetry } from "../types/api";
import { HomeAllRunner, OFFLINE_GRACE_MS, homeableAxes, type HomeAllDeps } from "./homeAll";

interface FakeOpts {
  refuse?: string;
  faultOn?: string;
  /** Data goes offline at this simulated time (ms). */
  offlineAt?: number;
  startState?: Telemetry["state"];
  alreadyHomed?: boolean;
  /** Frames a homing search takes. */
  frames?: number;
}

/**
 * A fake engine producing one telemetry frame per nextChange (50 ms). The
 * first frame after a command still shows the old state, as on the wire.
 */
function fakeEngine(ids: string[], o: FakeOpts = {}) {
  let clock = 0;
  let t: Telemetry = {
    seq: 10,
    time_ms: 0,
    state: o.startState ?? "ready",
    fault: null,
    mcu: {} as Telemetry["mcu"],
    axes: ids.map((id) => ({ id, homed: o.alreadyHomed ?? false, enabled: true, commanded_position: 0, measured_position: 0, velocity: 0, endstop: false })),
  };
  let homing: { id: string; left: number; stale: number } | null = null;
  const sent: string[] = [];
  const overlap: string[] = [];
  const deps: HomeAllDeps = {
    home: async (id) => {
      if (homing) overlap.push(id);
      sent.push(`home ${id}`);
      if (o.refuse === id) return "forbidden: requires the operator role";
      homing = { id, left: o.frames ?? 3, stale: 1 };
      return null;
    },
    stop: async () => {
      sent.push("stop");
      homing = null;
      t = { ...t, seq: t.seq + 1, state: "ready" };
    },
    telemetry: () => ({ t, online: o.offlineAt === undefined || clock < o.offlineAt }),
    nextChange: async () => {
      clock += 50;
      const h = homing;
      let state = t.state;
      let fault = t.fault;
      let axes = t.axes;
      if (h) {
        if (h.stale > 0) h.stale--;
        else if (o.faultOn === h.id) {
          state = "faulted";
          fault = { code: "homing_failed", message: "no endstop within max_travel", axis: h.id };
          homing = null;
        } else if (h.left > 0) {
          h.left--;
          state = "homing";
          axes = axes.map((a) => (a.id === h.id ? { ...a, homed: false } : a));
        } else {
          state = "ready";
          axes = axes.map((a) => (a.id === h.id ? { ...a, homed: true } : a));
          homing = null;
        }
      }
      t = { ...t, seq: t.seq + 1, state, fault, axes };
    },
    now: () => clock,
  };
  return { deps, sent, overlap, state: () => t };
}

const IDS = ["j1", "j2", "j3"];

describe("homeableAxes", () => {
  it("keeps profile order and skips axes without homing", () => {
    const ax = (id: string, home: number | null) => ({ id, home_position: home }) as AxisConfig;
    expect(homeableAxes([ax("x", 0), ax("free", null), ax("j1", -170)])).toEqual(["x", "j1"]);
    expect(homeableAxes(null)).toEqual([]);
  });
});

describe("HomeAllRunner", () => {
  it("homes every axis in order, one at a time", async () => {
    const f = fakeEngine(IDS);
    const r = new HomeAllRunner(f.deps);
    expect(await r.start(IDS)).toEqual({ kind: "done", axes: IDS });
    expect(f.sent).toEqual(["home j1", "home j2", "home j3"]);
    expect(f.overlap).toEqual([]);
    expect(f.state().axes.every((a) => a.homed)).toBe(true);
  });

  it("does not mistake the stale frame of an already-homed axis for completion", async () => {
    const f = fakeEngine(IDS, { alreadyHomed: true, frames: 5 });
    await new HomeAllRunner(f.deps).start(IDS);
    expect(f.overlap).toEqual([]); // never sent the next home while one was running
    expect(f.sent).toEqual(["home j1", "home j2", "home j3"]);
  });

  it("stops at the first fault and sends nothing more", async () => {
    const f = fakeEngine(IDS, { faultOn: "j2" });
    const s = await new HomeAllRunner(f.deps).start(IDS);
    expect(s).toMatchObject({ kind: "failed", index: 1 });
    expect(s.kind === "failed" && s.reason).toContain("homing_failed while homing j2");
    expect(f.sent).toEqual(["home j1", "home j2"]);
  });

  it("reports the engine's refusal", async () => {
    const f = fakeEngine(IDS, { refuse: "j1" });
    const s = await new HomeAllRunner(f.deps).start(IDS);
    expect(s.kind === "failed" && s.reason).toBe("homing j1 refused: forbidden: requires the operator role");
    expect(f.sent).toEqual(["home j1"]);
  });

  it("gives up when live data is lost", async () => {
    const f = fakeEngine(IDS, { offlineAt: 100, frames: 200 });
    const s = await new HomeAllRunner(f.deps).start(IDS);
    expect(s.kind === "failed" && s.reason).toBe("lost live data while homing j1");
    expect(f.state().seq).toBeGreaterThan(10 + OFFLINE_GRACE_MS / 50 - 5);
    expect(f.sent).toEqual(["home j1"]);
  });

  it("does not start unless the robot is ready", async () => {
    const f = fakeEngine(IDS, { startState: "disabled" });
    const s = await new HomeAllRunner(f.deps).start(IDS);
    expect(s.kind === "failed" && s.reason).toContain("robot is disabled");
    expect(f.sent).toEqual([]);
  });

  it("cancel stops the moving axis and ends the sequence", async () => {
    const f = fakeEngine(IDS, { frames: 50 });
    const r = new HomeAllRunner(f.deps);
    const done = r.start(IDS);
    // Let j1 start, then cancel.
    for (let i = 0; i < 5; i++) await f.deps.nextChange(0);
    await r.cancel();
    expect(await done).toEqual({ kind: "cancelled", axes: IDS, index: 0 });
    expect(f.sent).toEqual(["home j1", "stop"]);
    r.dismiss();
    expect(r.getState()).toEqual({ kind: "idle" });
  });

  it("ignores a second start while running", async () => {
    const f = fakeEngine(IDS);
    const r = new HomeAllRunner(f.deps);
    const a = r.start(IDS);
    await r.start(["j3"]);
    await a;
    expect(f.sent).toEqual(["home j1", "home j2", "home j3"]);
  });
});

/** A fake engine that runs a home-all plan itself, group by group. */
function fakePlanEngine(groups: string[][], o: { refuse?: boolean; faultInGroup?: number; framesPerGroup?: number } = {}) {
  const ids = groups.flat();
  let clock = 0;
  let t: Telemetry = {
    seq: 10,
    time_ms: 0,
    state: "ready",
    fault: null,
    mcu: {} as Telemetry["mcu"],
    axes: ids.map((id) => ({ id, homed: false, homing: false, enabled: true, commanded_position: 0, measured_position: 0, velocity: 0, endstop: false })),
  };
  let run: { g: number; left: number; stale: number } | null = null;
  const sent: string[] = [];
  const seenGroups: number[] = [];
  const deps: HomeAllDeps = {
    home: async () => "unused",
    stop: async () => {
      sent.push("stop");
      run = null;
      t = { ...t, seq: t.seq + 1, state: "ready", axes: t.axes.map((a) => ({ ...a, homing: false })) };
    },
    homeAll: async () => {
      sent.push("home_all");
      if (o.refuse) return "invalid_state: robot is not ready";
      run = { g: 0, left: o.framesPerGroup ?? 3, stale: 1 };
      return null;
    },
    telemetry: () => ({ t, online: true }),
    nextChange: async () => {
      clock += 50;
      let { state, fault, axes } = t;
      const r = run;
      if (r) {
        if (r.stale > 0) r.stale--;
        else if (o.faultInGroup === r.g) {
          state = "faulted";
          fault = { code: "homing_failed", message: "no endstop", axis: groups[r.g]![0]! };
          axes = axes.map((a) => ({ ...a, homing: false }));
          run = null;
        } else if (r.left > 0) {
          r.left--;
          state = "homing";
          if (seenGroups.at(-1) !== r.g) seenGroups.push(r.g);
          axes = axes.map((a) => ({ ...a, homing: groups[r.g]!.includes(a.id) }));
        } else {
          axes = axes.map((a) => (groups[r.g]!.includes(a.id) ? { ...a, homed: true, homing: false } : a));
          if (r.g + 1 < groups.length) run = { g: r.g + 1, left: o.framesPerGroup ?? 3, stale: 0 };
          else {
            state = "ready";
            run = null;
          }
        }
      }
      t = { ...t, seq: t.seq + 1, state, fault, axes };
    },
    now: () => clock,
  };
  return { deps, sent, seenGroups };
}

const PLAN = [
  ["j4", "j5", "j6"],
  ["j1", "j2", "j3"],
];

describe("HomeAllRunner with the engine's plan", () => {
  it("sends one home_all and follows the groups to the end", async () => {
    const f = fakePlanEngine(PLAN);
    const r = new HomeAllRunner(f.deps);
    const indices: number[] = [];
    r.subscribe(() => {
      const s = r.getState();
      if (s.kind === "running" && indices.at(-1) !== s.index) indices.push(s.index);
    });
    expect(await r.startPlan(PLAN)).toEqual({ kind: "done", axes: ["j4, j5, j6", "j1, j2, j3"] });
    expect(f.sent).toEqual(["home_all"]);
    expect(indices).toEqual([0, 1]);
  });

  it("reports a refusal and a fault in a later group", async () => {
    const refused = await new HomeAllRunner(fakePlanEngine(PLAN, { refuse: true }).deps).startPlan(PLAN);
    expect(refused.kind === "failed" && refused.reason).toBe("home all refused: invalid_state: robot is not ready");
    const faulted = await new HomeAllRunner(fakePlanEngine(PLAN, { faultInGroup: 1 }).deps).startPlan(PLAN);
    expect(faulted).toMatchObject({ kind: "failed", index: 1 });
    expect(faulted.kind === "failed" && faulted.reason).toContain("homing_failed");
  });

  it("cancel sends a stop", async () => {
    const f = fakePlanEngine(PLAN, { framesPerGroup: 50 });
    const r = new HomeAllRunner(f.deps);
    const done = r.startPlan(PLAN);
    for (let i = 0; i < 5; i++) await f.deps.nextChange(0);
    await r.cancel();
    expect(await done).toMatchObject({ kind: "cancelled", index: 0 });
    expect(f.sent).toEqual(["home_all", "stop"]);
  });
});
