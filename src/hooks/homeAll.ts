// "Home all".
//
// * Engine plan (engine-api >= 0.1.4): one `home_all` command; the engine homes
//   the axes of each group at the same time, groups in order, as designed in
//   the robot profile. This only follows the progress in telemetry.
// * Fallback (older engines): homes every homeable axis one after the other,
//   in profile order, waiting for engine telemetry between the commands.
//
// Any fault, emergency stop, disconnect or stale data ends the sequence.

import type { AxisConfig, Telemetry } from "../types/api";

export type HomeAllState =
  | { kind: "idle" }
  | { kind: "running"; axes: string[]; index: number }
  | { kind: "done"; axes: string[] }
  | { kind: "failed"; axes: string[]; index: number; reason: string }
  | { kind: "cancelled"; axes: string[]; index: number };

/** Axes that can be homed, in profile order. */
export function homeableAxes(axes: AxisConfig[] | null | undefined): string[] {
  return (axes ?? []).filter((a) => a.home_position !== null).map((a) => a.id);
}

export interface HomeAllDeps {
  /** Send a home command; resolves null when accepted, else the error message. */
  home: (axis: string) => Promise<string | null>;
  /** Send a controlled stop. */
  stop: () => Promise<unknown>;
  /** Send the engine's home_all; resolves null when accepted, else the error. */
  homeAll?: () => Promise<string | null>;
  /** Latest telemetry and whether it is live (connected and fresh). */
  telemetry: () => { t: Telemetry | null; online: boolean };
  /** Resolves on the next store change (or after `ms`). */
  nextChange: (ms: number) => Promise<void>;
  now: () => number;
}

/** Per-axis limit; homing searches can be long (slow speed, long travel). */
export const HOME_AXIS_TIMEOUT_MS = 180_000;
/** How long data may be missing before the sequence gives up. */
export const OFFLINE_GRACE_MS = 2_000;

export class HomeAllRunner {
  private state: HomeAllState = { kind: "idle" };
  private listeners = new Set<() => void>();
  private cancelRequested = false;

  constructor(private readonly deps: HomeAllDeps) {}

  getState = (): HomeAllState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(s: HomeAllState) {
    this.state = s;
    this.listeners.forEach((l) => l());
  }

  running(): boolean {
    return this.state.kind === "running";
  }

  /** Clear a finished/failed/cancelled result. */
  dismiss() {
    if (!this.running()) this.set({ kind: "idle" });
  }

  /** Stop the sequence and the axis that is moving. */
  async cancel() {
    if (!this.running()) return;
    this.cancelRequested = true;
    await this.deps.stop();
  }

  async start(axes: string[]): Promise<HomeAllState> {
    if (this.running() || axes.length === 0) return this.state;
    this.cancelRequested = false;
    for (let i = 0; i < axes.length; i++) {
      const id = axes[i]!;
      this.set({ kind: "running", axes, index: i });
      const failure = await this.homeOne(id);
      if (this.cancelRequested) {
        this.set({ kind: "cancelled", axes, index: i });
        return this.state;
      }
      if (failure) {
        this.set({ kind: "failed", axes, index: i, reason: failure });
        return this.state;
      }
    }
    this.set({ kind: "done", axes });
    return this.state;
  }

  /**
   * Run the engine's home-all plan. Each entry of the state's `axes` is a
   * group label ("j4, j5, j6"); `index` is the group currently homing.
   */
  async startPlan(groups: string[][]): Promise<HomeAllState> {
    const { homeAll, telemetry, nextChange, now } = this.deps;
    if (this.running() || groups.length === 0 || !homeAll) return this.state;
    this.cancelRequested = false;
    const labels = groups.map((g) => g.join(", "));
    this.set({ kind: "running", axes: labels, index: 0 });
    const fail = (index: number, reason: string) => {
      this.set({ kind: "failed", axes: labels, index, reason });
      return this.state;
    };
    const before = telemetry();
    if (!before.online || before.t?.state !== "ready") return fail(0, `robot is ${before.online ? before.t?.state : "not live"}; it must be ready`);
    const refused = await homeAll();
    if (refused) return fail(0, `home all refused: ${refused}`);
    const seq0 = telemetry().t?.seq ?? 0;
    const start = now();
    let offlineSince: number | null = null;
    let index = 0;
    const all = groups.flat();
    for (;;) {
      if (this.cancelRequested) {
        this.set({ kind: "cancelled", axes: labels, index });
        return this.state;
      }
      const { t, online } = telemetry();
      if (!online || !t) {
        offlineSince ??= now();
        if (now() - offlineSince > OFFLINE_GRACE_MS) return fail(index, "lost live data while homing");
      } else {
        offlineSince = null;
        const homing = new Set(t.axes.filter((a) => a.homing).map((a) => a.id));
        const g = groups.findIndex((grp) => grp.some((id) => homing.has(id)));
        if (g >= 0 && g !== index) {
          index = g;
          this.set({ kind: "running", axes: labels, index });
        }
        if (t.state === "faulted" || t.state === "emergency_stopped") {
          // The first group not fully homed is the one that stopped.
          const open = groups.findIndex((grp) => grp.some((id) => !t.axes.find((a) => a.id === id)?.homed));
          if (open > index) index = open;
          return fail(index, t.fault ? `${t.fault.code}: ${t.fault.message}` : `robot ${t.state.replace("_", " ")}`);
        }
        if (t.seq >= seq0 + 2 && t.state === "ready") {
          const missing = all.filter((id) => !t.axes.find((a) => a.id === id)?.homed);
          if (missing.length === 0) {
            this.set({ kind: "done", axes: labels });
            return this.state;
          }
          return fail(index, `stopped before ${missing.join(", ")} reached ${missing.length === 1 ? "its endstop" : "their endstops"}`);
        }
      }
      if (now() - start > HOME_AXIS_TIMEOUT_MS * groups.length) return fail(index, "home all took too long");
      await nextChange(250);
    }
  }

  /** Home one axis; returns an error message, or null on success. */
  private async homeOne(id: string): Promise<string | null> {
    const { home, telemetry, nextChange, now } = this.deps;
    const before = telemetry();
    if (!before.online || before.t?.state !== "ready") return `robot is ${before.online ? before.t?.state : "not live"}; it must be ready`;
    const refused = await home(id);
    if (refused) return `homing ${id} refused: ${refused}`;
    // Only telemetry produced after the command was accepted counts: the
    // frame in flight may still show the old state.
    const seq0 = telemetry().t?.seq ?? 0;
    const start = now();
    let offlineSince: number | null = null;
    for (;;) {
      if (this.cancelRequested) return null;
      const { t, online } = telemetry();
      if (!online || !t) {
        offlineSince ??= now();
        if (now() - offlineSince > OFFLINE_GRACE_MS) return `lost live data while homing ${id}`;
      } else {
        offlineSince = null;
        if (t.state === "faulted" || t.state === "emergency_stopped") {
          return t.fault ? `${t.fault.code} while homing ${id}: ${t.fault.message}` : `robot ${t.state.replace("_", " ")} while homing ${id}`;
        }
        const axis = t.axes.find((a) => a.id === id);
        if (t.seq >= seq0 + 2 && t.state === "ready") {
          return axis?.homed ? null : `${id} stopped before reaching its endstop`;
        }
      }
      if (now() - start > HOME_AXIS_TIMEOUT_MS) return `homing ${id} took longer than ${HOME_AXIS_TIMEOUT_MS / 1000} s`;
      await nextChange(250);
    }
  }
}
