// Shared rules for absolute joint moves sent from the UI: one joint →
// move_to, several joints → one coordinated move_j (engine-api >= 0.2), where
// every joint starts and finishes at the same time on a straight line in
// joint space. The engine validates everything again; these checks only
// explain up front why a move would be refused.

import type { AxisConfig, CommandName, CommandParams, RobotConfig, RobotState, Telemetry } from "../../types/api";
import { fmt } from "../../components/common";
import { allowed, apiAtLeast } from "./axes";
import { checkPath, type Contact } from "./kinematics";

/** Speed choices: fraction of every joint's maximum velocity. */
export const SPEEDS = [0.25, 0.5, 1] as const;

export type JointTargets = Record<string, number>;

/**
 * First collision on the straight joint-space path to `targets`, with the
 * engine's model; null when the path is clear or the engine does not check
 * (no link radii, or not every axis homed).
 */
export function pathContact(config: RobotConfig | null, t: Telemetry | null, targets: JointTargets): Contact | null {
  if (!config?.collision_checking || !t || Object.keys(targets).length === 0 || !t.axes.every((a) => a.homed)) return null;
  const q = Object.fromEntries(t.axes.map((a) => [a.id, a.commanded_position]));
  return checkPath(config.axes, q, targets);
}

/** "Would collide: …" for a contact on the way to `targets`. */
export function describeContact(c: Contact, targets: JointTargets, cfgs: AxisConfig[]): string {
  const ids = Object.keys(targets);
  const unit = (id: string) => cfgs.find((a) => a.id === id)?.unit ?? "";
  const where =
    ids.length === 1
      ? `when ${ids[0]} reaches ${fmt(c.at[ids[0]!], 1)} ${unit(ids[0]!)}`
      : `at ${ids.map((id) => `${id} ${fmt(c.at[id], 1)}`).join(", ")}`;
  const what = c.b === "floor" ? `Would hit the floor (link of ${c.a})` : `Would collide: links of ${c.a} and ${c.b}`;
  return `${what} ${where}; the engine refuses this move.`;
}

export interface JointMoveInput {
  targets: JointTargets;
  /** Configured axes (soft limits, units). */
  axes: AxisConfig[];
  telemetry: Telemetry | null;
  online: boolean;
  canCommand: boolean;
  state: RobotState;
  apiVersion: string | null | undefined;
  contact: Contact | null;
}

/** Why the move cannot be sent, or null when it can. */
export function jointMoveBlocker(m: JointMoveInput): string | null {
  const ids = Object.keys(m.targets);
  const cfgs = m.axes;
  if (ids.length === 0) return "Nothing to move.";
  if (!m.online) return "Live data required.";
  if (!m.canCommand) return "Requires the operator role.";
  if (ids.length > 1 && !apiAtLeast(m.apiVersion, 0, 2)) return "Moving several joints together needs engine API 0.2 or newer.";
  const unhomed = ids.filter((id) => !m.telemetry?.axes.find((a) => a.id === id)?.homed);
  if (unhomed.length > 0) {
    return ids.length === 1
      ? "Home this axis first (Motion screen) to move to an absolute target."
      : `Home ${unhomed.join(", ")} first: absolute moves need homed axes.`;
  }
  for (const id of ids) {
    const c = cfgs.find((a) => a.id === id);
    const v = m.targets[id]!;
    if (c && (v < c.min || v > c.max)) {
      return ids.length === 1 ? `Target outside the soft limits [${c.min}, ${c.max}] ${c.unit}.` : `Target of ${id} outside the soft limits [${c.min}, ${c.max}] ${c.unit}.`;
    }
  }
  if (m.contact) return describeContact(m.contact, m.targets, cfgs);
  if (!allowed.move_j(m.state)) return `Robot is ${m.state.replace("_", " ")}; it must be ready.`;
  return null;
}

type Run = <C extends CommandName>(name: C, params: CommandParams[C]) => Promise<boolean>;

/** Send the move: move_to for one joint, one move_j for several. */
export function sendJointMove(run: Run, targets: JointTargets, speed: number, cfgs: AxisConfig[]): Promise<boolean> {
  const ids = Object.keys(targets);
  if (ids.length === 1) {
    const id = ids[0]!;
    const vmax = cfgs.find((a) => a.id === id)?.max_velocity;
    return run("move_to", { axis: id, position: targets[id]!, ...(speed < 1 && vmax ? { velocity: vmax * speed } : {}) });
  }
  return run("move_j", { targets, ...(speed < 1 ? { speed_scale: speed } : {}) });
}
