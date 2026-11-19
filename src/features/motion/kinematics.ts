// Kinematic tree from the engine's axis geometry (engine-api >= 0.1.3), and a
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
  /**
   * No checked pose is below the margin, but the gap between two checked
   * poses near `at` could not be shown to stay above it; `gap` is the lowest
   * it could be.
   */
  between?: boolean;
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
  const m = collisionModel(axes);
  if (!m) return null;
  const gaps = itemGaps(m, q);
  let k = -1;
  gaps.forEach((g, i) => {
    if (k < 0 || g < gaps[k]!) k = i;
  });
  return k < 0 ? { a: "", b: "", gap: Infinity, at: { ...q } } : contact(m, k, gaps[k]!, q, false);
}

/** Finest resolution of the certified check, mm (as in the engine). */
const RESOLUTION_MM = 0.01;
/** How far a gap already below the margin may dip while backing out, mm. */
const BACK_OUT_MM = 0.1;
const MAX_CHECKS = 500_000;

interface Model {
  ids: string[];
  prismatic: boolean[];
  radius: number[];
  /** Local segment ends of each body (non-zero only). */
  ends: Vec3[][];
  /** Pairs of bodies, then the floor gap of each body not on the base. */
  items: ({ pair: [number, number] } | { floor: number })[];
  /** Joints that can change each item's gap, with the body they move. */
  movers: [number, number][][];
  /** reach[x][i]: bound on the distance of body x's points from joint i's axis. */
  reach: ({ fixed: number; prismatic: number[] } | null)[][];
  axes: AxisConfig[];
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function axisDistance(v: Vec3, axis: Vec3): number {
  const n = len3(axis);
  if (n < 1e-12) return len3(v);
  const u: Vec3 = [axis[0] / n, axis[1] / n, axis[2] / n];
  const t = dot3(v, u);
  return len3([v[0] - u[0] * t, v[1] - u[1] * t, v[2] - u[2] * t]);
}

function collisionModel(axes: AxisConfig[]): Model | null {
  if (!hasCollisionModel(axes)) return null;
  const tree = kinematicTree(axes);
  if (!tree.ok) return null;
  const order = tree.order;
  const ids = order.map((a) => a.id);
  const n = ids.length;
  const parent = order.map((a) => (a.geometry!.parent === null ? null : ids.indexOf(a.geometry!.parent)));
  const ends: Vec3[][] = order.map((a) => {
    const own: Vec3[] = (tree.children.get(a.id) ?? []).map((c) => c.geometry!.origin_mm);
    if (a.geometry!.tip_mm) own.push(a.geometry!.tip_mm);
    return own.filter((e) => len3(e) > ZERO);
  });
  const volume = (i: number) => ends[i]!.length > 0;
  const chain = (x: number) => {
    const out = [x];
    for (let c = parent[x]!; c !== null; c = parent[c]!) out.push(c);
    return out;
  };
  const touching = (x: number, y: number) => {
    for (const [lo, hi] of [
      [x, y],
      [y, x],
    ] as const) {
      let empty = true;
      for (let c = parent[hi]!; c !== null; c = parent[c]!) {
        if (c === lo) return empty;
        if (volume(c)) empty = false;
      }
    }
    return false;
  };
  const prismatic = order.map((a) => a.kind === "prismatic");
  const reach: Model["reach"] = ids.map(() => ids.map(() => null));
  for (let x = 0; x < n; x++) {
    if (!volume(x)) continue;
    const longest = Math.max(0, ...ends[x]!.map(len3));
    const up = chain(x);
    up.forEach((i, depth) => {
      const g = order[i]!.geometry!;
      if (prismatic[i]) reach[x]![i] = { fixed: 1, prismatic: [] };
      else if (i === x) reach[x]![i] = { fixed: Math.max(0, ...ends[x]!.map((e) => axisDistance(e, g.axis))), prismatic: [] };
      else {
        const below = up.slice(0, depth).reverse();
        const first = axisDistance(order[below[0]!]!.geometry!.origin_mm, g.axis);
        const rest = below.slice(1).reduce((s, k) => s + len3(order[k]!.geometry!.origin_mm), 0);
        reach[x]![i] = { fixed: first + rest + longest, prismatic: below.filter((k) => prismatic[k]) };
      }
    });
  }
  const items: Model["items"] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (volume(a) && volume(b) && !touching(a, b)) items.push({ pair: [a, b] });
  for (let x = 0; x < n; x++) if (parent[x] !== null && volume(x)) items.push({ floor: x });
  const movers = items.map((it) => {
    if ("floor" in it) return chain(it.floor).map((i): [number, number] => [i, it.floor]);
    const [a, b] = it.pair;
    const [ca, cb] = [chain(a), chain(b)];
    return [...ca.filter((i) => !cb.includes(i)).map((i): [number, number] => [i, a]), ...cb.filter((i) => !ca.includes(i)).map((i): [number, number] => [i, b])];
  });
  return { ids, prismatic, radius: order.map((a) => a.geometry!.radius_mm!), ends, items, movers, reach, axes };
}

function itemGaps(m: Model, q: Record<string, number>): number[] {
  const frames = forwardKinematics(m.axes, q);
  const segs = m.ids.map((id, i) => {
    const f = frames.get(id)!;
    const o = position(f);
    return m.ends[i]!.map((e): [Vec3, Vec3] => [o, position(mul(f, translate(e)))]);
  });
  return m.items.map((it) => {
    let gap = Infinity;
    if ("floor" in it) {
      for (const [p, e] of segs[it.floor]!) gap = Math.min(gap, Math.min(p[2], e[2]) - m.radius[it.floor]!);
    } else {
      const [a, b] = it.pair;
      for (const [p1, q1] of segs[a]!) for (const [p2, q2] of segs[b]!) gap = Math.min(gap, segmentDistance(p1, q1, p2, q2) - m.radius[a]! - m.radius[b]!);
    }
    return gap;
  });
}

function contact(m: Model, k: number, gap: number, at: Record<string, number>, between: boolean): Contact {
  const it = m.items[k]!;
  const [a, b] = "floor" in it ? [m.ids[it.floor]!, "floor"] : [m.ids[it.pair[0]]!, m.ids[it.pair[1]]!];
  return between ? { a, b, gap, at: { ...at }, between } : { a, b, gap, at: { ...at } };
}

/**
 * First pose with less than the margin when moving `id` from q[id] to `to`
 * (others held still), or null when the move is clear.
 */
export function checkSweep(axes: AxisConfig[], q: Record<string, number>, id: string, to: number): Contact | null {
  return checkPath(axes, q, { [id]: to });
}

/**
 * Certified check of the straight joint-space line from `q` to `q` with
 * `targets` applied (the path of a MoveJ: every listed joint moves at once,
 * the others hold); null when the margin holds along the whole line, not
 * only at the checked poses. Same algorithm as the engine: each joint can
 * move a point of a link no faster than its distance from the joint's axis
 * allows, so from each checked pose the check steps only as far as the
 * remaining clearance above the margin allows (at most 0.5° / 1 mm of the
 * joint that moves furthest). A gap already below the margin may back out:
 * it may not dip more than 0.1 mm below its start, nor end smaller.
 */
export function checkPath(axes: AxisConfig[], q: Record<string, number>, targets: Record<string, number>): Contact | null {
  const m = collisionModel(axes);
  if (!m) return null;
  const nj = m.ids.length;
  const from = m.ids.map((id) => q[id] ?? 0);
  const dq = m.ids.map((id, i) => (id in targets ? targets[id]! : from[i]!) - from[i]!);
  const travel = from.map((f, i) => Math.max(Math.abs(f), Math.abs(f + dq[i]!)));
  const lip = m.movers.map((mv) =>
    mv.reduce((s, [i, x]) => {
      const r = m.reach[x]![i]!;
      const d = r.fixed + r.prismatic.reduce((t, k) => t + travel[k]!, 0);
      return s + (m.prismatic[i] ? d : d * DEG) * Math.abs(dq[i]!);
    }, 0),
  );
  const n = Math.min(10_000, Math.max(1, Math.ceil(Math.max(0, ...dq.map((d, i) => Math.abs(d) / (m.prismatic[i] ? 1 : 0.5))))));
  const dsMax = 1 / n;
  const lipMax = Math.max(0, ...lip);
  const dsMin = lipMax > 0 ? Math.min(dsMax, RESOLUTION_MM / lipMax) : dsMax;
  const pose = (s: number) => {
    const out = { ...q };
    for (let i = 0; i < nj; i++) out[m.ids[i]!] = from[i]! + dq[i]! * s;
    return out;
  };
  const start = itemGaps(m, pose(0));
  const floor = start.map((e) => (e >= COLLISION_MARGIN_MM ? COLLISION_MARGIN_MM : e - BACK_OUT_MM));
  const below = (e: number[]) => e.findIndex((g, k) => g < floor[k]!);
  let e0 = start;
  let s = 0;
  let checks = 1;
  while (s < 1) {
    let ds = dsMax;
    lip.forEach((l, k) => {
      if (l > 0) ds = Math.min(ds, (e0[k]! - floor[k]!) / l);
    });
    ds = Math.max(ds, dsMin);
    const s1 = ds >= 1 - s - 1e-12 ? 1 : s + ds;
    ds = s1 - s;
    const q1 = pose(s1);
    const e1 = itemGaps(m, q1);
    checks++;
    const hit = below(e1);
    if (hit >= 0) return contact(m, hit, e1[hit]!, q1, false);
    for (let k = 0; k < e1.length; k++) {
      const low = Math.min((e0[k]! + e1[k]! - lip[k]! * ds) / 2, e0[k]!, e1[k]!);
      if (low < floor[k]! || checks >= MAX_CHECKS) {
        // Refused. Report a contact further on, if there is one.
        for (let t = s1; t < 1; ) {
          t = Math.min(1, t + dsMax);
          const e = itemGaps(m, pose(t));
          const j = below(e);
          if (j >= 0) return contact(m, j, e[j]!, pose(t), false);
        }
        return contact(m, k, low, pose(s + ds / 2), true);
      }
    }
    s = s1;
    e0 = e1;
  }
  const worse = e0.findIndex((e, k) => start[k]! < COLLISION_MARGIN_MM && e < start[k]! - 1e-9);
  return worse >= 0 ? contact(m, worse, e0[worse]!, pose(1), false) : null;
}
