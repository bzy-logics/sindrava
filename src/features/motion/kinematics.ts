// Kinematic tree from the engine's axis geometry (engine-api >= 1.1), and a
// small dependency-free forward-kinematics implementation of its URDF-style
// convention:
//
//   frame(child) = frame(parent) · T(origin_mm) · RPY(rotation_deg) · Joint(q about axis)
//
// frame(parent) includes the parent's own joint motion; the base frame is the
// robot's world frame (Z up). Revolute q is in degrees, prismatic q in mm.
// Display only: nothing here plans or commands motion.

import type { AxisConfig, AxisGeometry } from "../../types/api";

export type Vec3 = [number, number, number];
/** Row-major 4×4 matrix. */
export type Mat4 = number[];

export type TreeResult =
  | { ok: true; order: AxisConfig[]; children: Map<string, AxisConfig[]>; roots: AxisConfig[] }
  | { ok: false; reason: string };

/**
 * Build the kinematic tree. Requires geometry on every axis, known parents and
 * no cycles (the engine validates this too; a client must not trust it blindly).
 * `order` lists parents before children.
 */
export function kinematicTree(axes: AxisConfig[]): TreeResult {
  if (axes.length === 0) return { ok: false, reason: "no axes" };
  const missing = axes.filter((a) => !a.geometry).map((a) => a.id);
  if (missing.length === axes.length) return { ok: false, reason: "the robot profile defines no geometry" };
  if (missing.length > 0) return { ok: false, reason: `axes without geometry: ${missing.join(", ")}` };
  const byId = new Map(axes.map((a) => [a.id, a]));
  const children = new Map<string, AxisConfig[]>();
  const roots: AxisConfig[] = [];
  for (const a of axes) {
    const p = a.geometry!.parent;
    if (p === null) roots.push(a);
    else if (!byId.has(p) || p === a.id) return { ok: false, reason: `axis ${a.id}: unknown parent ${p}` };
    else children.set(p, [...(children.get(p) ?? []), a]);
  }
  const order: AxisConfig[] = [];
  const visit = (a: AxisConfig) => {
    order.push(a);
    for (const c of children.get(a.id) ?? []) visit(c);
  };
  roots.forEach(visit);
  if (order.length !== axes.length) return { ok: false, reason: "the parent chain forms a cycle" };
  return { ok: true, order, children, roots };
}

// ---------------------------------------------------------------- math

const DEG = Math.PI / 180;

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[r * 4 + c]! += a[r * 4 + k]! * b[k * 4 + c]!;
  return out;
}

export function translate([x, y, z]: Vec3): Mat4 {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

/** Rotation by `angle` (rad) about unit axis `u` (Rodrigues). */
export function rotate(u: Vec3, angle: number): Mat4 {
  const [x, y, z] = u;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

/** URDF rpy: R = Rz(yaw) · Ry(pitch) · Rx(roll), angles in degrees. */
export function rpy([r, p, y]: Vec3): Mat4 {
  return mul(rotate([0, 0, 1], y * DEG), mul(rotate([0, 1, 0], p * DEG), rotate([1, 0, 0], r * DEG)));
}

/** Transform from the parent frame to the moving joint frame for joint value q. */
export function jointTransform(kind: AxisConfig["kind"], g: AxisGeometry, q: number): Mat4 {
  const mount = mul(translate(g.origin_mm), rpy(g.rotation_deg));
  const motion = kind === "prismatic" ? translate([g.axis[0] * q, g.axis[1] * q, g.axis[2] * q]) : rotate(g.axis, q * DEG);
  return mul(mount, motion);
}

export function position(m: Mat4): Vec3 {
  return [m[3]!, m[7]!, m[11]!];
}

/** World frame of every joint (after its own motion) for joint values `q` (missing = 0). */
export function forwardKinematics(axes: AxisConfig[], q: Record<string, number>): Map<string, Mat4> {
  const tree = kinematicTree(axes);
  const out = new Map<string, Mat4>();
  if (!tree.ok) return out;
  for (const a of tree.order) {
    const parent = a.geometry!.parent;
    const base = parent === null ? identity() : out.get(parent)!;
    out.set(a.id, mul(base, jointTransform(a.kind, a.geometry!, q[a.id] ?? 0)));
  }
  return out;
}
