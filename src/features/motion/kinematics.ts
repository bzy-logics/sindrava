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

// ---------------------------------------------------------------- collision
//
// Same capsule model as the engine (motioncore-kinematics `collision`):
// each joint's link is capsules of radius `radius_mm` from the joint to the
// joints mounted on it and to its tip. Used to warn before a move is sent;
// the engine checks again and has the final word.

/** Required surface clearance, mm (as in the engine). */
export const COLLISION_MARGIN_MM = 2;

export interface Contact {
  a: string;
  /** Second joint, or "floor". */
  b: string;
  /** Surface gap (negative = overlap), mm. */
  gap: number;
  /** Joint values at which it occurs. */
  at: Record<string, number>;
}

/** True when every axis has geometry with a link radius. */
export function hasCollisionModel(axes: AxisConfig[]): boolean {
  return axes.length > 0 && axes.every((a) => a.geometry && typeof a.geometry.radius_mm === "number");
}

const ZERO = 1e-6;
const len3 = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** Exact minimum distance between segments p1–q1 and p2–q2. */
export function segmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1: Vec3 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
  const d2: Vec3 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r: Vec3 = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const EPS = 1e-12;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) return len3(r);
  if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return len3([p1[0] + d1[0] * s - (p2[0] + d2[0] * t), p1[1] + d1[1] * s - (p2[1] + d2[1] * t), p1[2] + d1[2] * s - (p2[2] + d2[2] * t)]);
}

/** Smallest surface gap at joint values `q`, or null without a model. */
export function clearance(axes: AxisConfig[], q: Record<string, number>): Contact | null {
  if (!hasCollisionModel(axes)) return null;
  const tree = kinematicTree(axes);
  if (!tree.ok) return null;
  const frames = forwardKinematics(axes, q);
  const ends = new Map<string, Vec3[]>();
  for (const a of axes) {
    const own: Vec3[] = (tree.children.get(a.id) ?? []).map((c) => c.geometry!.origin_mm);
    if (a.geometry!.tip_mm) own.push(a.geometry!.tip_mm);
    ends.set(
      a.id,
      own.filter((e) => len3(e) > ZERO),
    );
  }
  const volume = (id: string) => ends.get(id)!.length > 0;
  const parentOf = new Map(axes.map((a) => [a.id, a.geometry!.parent]));
  const touching = (x: string, y: string) => {
    for (const [lo, hi] of [
      [x, y],
      [y, x],
    ] as const) {
      let cur = parentOf.get(hi) ?? null;
      let empty = true;
      while (cur !== null) {
        if (cur === lo) return empty;
        if (volume(cur)) empty = false;
        cur = parentOf.get(cur) ?? null;
      }
    }
    return false;
  };
  const segs = new Map<string, [Vec3, Vec3][]>();
  for (const a of axes) {
    const f = frames.get(a.id)!;
    const o = position(f);
    segs.set(
      a.id,
      ends.get(a.id)!.map((e) => [o, position(mul(f, translate(e)))]),
    );
  }
  const r = (id: string) => axes.find((a) => a.id === id)!.geometry!.radius_mm!;
  let worst: Contact = { a: "", b: "", gap: Infinity, at: { ...q } };
  const ids = axes.map((a) => a.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [x, y] = [ids[i]!, ids[j]!];
      if (!volume(x) || !volume(y) || touching(x, y)) continue;
      for (const [p1, q1] of segs.get(x)!)
        for (const [p2, q2] of segs.get(y)!) {
          const gap = segmentDistance(p1, q1, p2, q2) - r(x) - r(y);
          if (gap < worst.gap) worst = { a: x, b: y, gap, at: { ...q } };
        }
    }
  }
  for (const a of axes) {
    if (a.geometry!.parent === null) continue; // stands on the base
    for (const [p, e] of segs.get(a.id)!) {
      const gap = Math.min(p[2], e[2]) - r(a.id);
      if (gap < worst.gap) worst = { a: a.id, b: "floor", gap, at: { ...q } };
    }
  }
  return worst;
}

/**
 * First pose with less than the margin when moving `id` from q[id] to `to`
 * (others held still), or null when the move is clear. Moves that never get
 * worse than the start are allowed, as in the engine.
 */
export function checkSweep(axes: AxisConfig[], q: Record<string, number>, id: string, to: number): Contact | null {
  const start = clearance(axes, q);
  if (!start) return null;
  const from = q[id] ?? 0;
  const prismatic = axes.find((a) => a.id === id)?.kind === "prismatic";
  const n = Math.min(10_000, Math.max(1, Math.ceil(Math.abs(to - from) / (prismatic ? 1 : 0.5))));
  for (let k = 1; k <= n; k++) {
    const c = clearance(axes, { ...q, [id]: from + ((to - from) * k) / n })!;
    if (c.gap < COLLISION_MARGIN_MM && c.gap < start.gap - 1e-6) return c;
  }
  return null;
}
