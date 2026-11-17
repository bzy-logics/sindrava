// Three.js scene for a robot with kinematic geometry: one connected chain
// per pose (measured / commanded), following the same convention as
// kinematics.ts. Kept free of rendering so it can be tested headless.

import * as THREE from "three";
import type { AxisConfig } from "../../types/api";
import { kinematicTree } from "./kinematics";

const DEG = Math.PI / 180;
/** Target size of the robot in scene units. */
const TARGET_EXTENT = 4;

export interface ChainJoint {
  cfg: AxisConfig;
  /** Moves with the joint value. */
  joint: THREE.Object3D;
  axis: THREE.Vector3;
}

export interface Chain {
  /** Robot root; robot Z-up is mapped to the scene's Y-up. */
  root: THREE.Group;
  joints: Map<string, ChainJoint>;
  /** Scene units per mm. */
  scale: number;
}

/** Scene units per mm so that the robot's reach is about TARGET_EXTENT. */
export function sceneScale(axes: AxisConfig[]): number {
  let reach = 0;
  for (const a of axes) {
    const g = a.geometry;
    if (!g) continue;
    reach += Math.hypot(...g.origin_mm);
    if (g.tip_mm) reach += Math.hypot(...g.tip_mm);
    if (a.kind === "prismatic") reach += Math.max(Math.abs(a.min), Math.abs(a.max));
  }
  return TARGET_EXTENT / Math.max(reach, 1);
}

/** A cylinder from `a` to `b` (scene units). */
function linkBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh | null {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  if (len < 1e-6) return null;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 16), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(len));
  return m;
}

function alongAxis(axis: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
}

export interface ChainMaterials {
  body: THREE.Material;
  /** Static parts (rails); omit to skip them (e.g. for the ghost pose). */
  fixed?: THREE.Material;
  limit?: THREE.Material;
}

/**
 * Build one connected robot. Returns null when the geometry is incomplete or
 * inconsistent (the caller then falls back to per-axis visuals).
 */
export function buildChain(axes: AxisConfig[], mats: ChainMaterials, scale = sceneScale(axes)): Chain | null {
  const tree = kinematicTree(axes);
  if (!tree.ok) return null;
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2; // robot Z-up -> scene Y-up
  const joints = new Map<string, ChainJoint>();
  const DEFAULT_R = 0.09; // link radius (scene units) without a profile radius

  for (const a of tree.order) {
    const g = a.geometry!;
    const parent = g.parent === null ? root : joints.get(g.parent)!.joint;
    const mount = new THREE.Group();
    mount.name = `${a.id}:mount`;
    mount.position.set(g.origin_mm[0] * scale, g.origin_mm[1] * scale, g.origin_mm[2] * scale);
    // URDF rpy: R = Rz(yaw)·Ry(pitch)·Rx(roll) == three.js Euler order "ZYX".
    mount.rotation.set(g.rotation_deg[0] * DEG, g.rotation_deg[1] * DEG, g.rotation_deg[2] * DEG, "ZYX");
    parent.add(mount);

    const joint = new THREE.Group();
    joint.name = `${a.id}:joint`;
    mount.add(joint);
    const axis = new THREE.Vector3(...g.axis).normalize();
    // Real link thickness when the profile gives one (collision model).
    const r = typeof g.radius_mm === "number" ? g.radius_mm * scale : DEFAULT_R;

    if (a.kind === "prismatic") {
      if (mats.fixed) {
        // The rail spans the travel range along the slide direction.
        const from = axis.clone().multiplyScalar(a.min * scale);
        const to = axis.clone().multiplyScalar(a.max * scale);
        const rail = linkBetween(from, to, r * 1.3, mats.fixed);
        if (rail) mount.add(rail);
        if (mats.limit) {
          for (const end of [from, to]) {
            const stop = new THREE.Mesh(new THREE.CylinderGeometry(r * 2.4, r * 2.4, 0.04, 20), mats.limit);
            stop.position.copy(end);
            stop.quaternion.copy(alongAxis(axis));
            mount.add(stop);
          }
        }
      }
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(r * 5, r * 5, r * 5), mats.body);
      joint.add(carriage);
    } else {
      const hubR = typeof g.radius_mm === "number" ? r * 1.15 : r * 2;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, hubR * 1.5, 24), mats.body);
      hub.quaternion.copy(alongAxis(axis));
      joint.add(hub);
    }

    // Links to everything mounted on this joint, and to its tip.
    const ends = (tree.children.get(a.id) ?? []).map((c) => c.geometry!.origin_mm);
    if (g.tip_mm) ends.push(g.tip_mm);
    for (const e of ends) {
      const link = linkBetween(new THREE.Vector3(), new THREE.Vector3(e[0] * scale, e[1] * scale, e[2] * scale), r, mats.body);
      if (link) joint.add(link);
    }
    if (g.tip_mm) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(typeof g.radius_mm === "number" ? r * 1.1 : r * 1.6, 16, 12), mats.body);
      tip.position.set(g.tip_mm[0] * scale, g.tip_mm[1] * scale, g.tip_mm[2] * scale);
      joint.add(tip);
    }
    // Tag this joint's parts so a pick can be traced back to its axis. Child
    // joints are attached later (parents come first in `order`) and tag their
    // own parts, so a link belongs to the joint that moves it.
    mount.traverse((o) => (o.userData.axisId = a.id));
    joints.set(a.id, { cfg: a, joint, axis });
  }
  return { root, joints, scale };
}

/** The axis a picked object belongs to (walks up to the nearest tagged ancestor). */
export function axisOf(obj: THREE.Object3D | null): string | null {
  for (let o = obj; o; o = o.parent) if (typeof o.userData.axisId === "string") return o.userData.axisId;
  return null;
}

/**
 * Joint-value change (deg or mm) for dragging from `from` to `to` (rays in
 * world space). Revolute: angle swept around the joint axis, measured in the
 * plane through the joint perpendicular to its axis. Prismatic: travel along
 * the slide direction (closest approach of each ray to the slide line).
 * Returns null when the drag cannot be measured (ray parallel to the plane).
 */
export function dragDelta(chain: Chain, id: string, from: THREE.Ray, to: THREE.Ray): number | null {
  const j = chain.joints.get(id);
  if (!j) return null;
  chain.root.updateMatrixWorld(true);
  // Joint frame before its own motion = the mount (joint's parent).
  const mount = j.joint.parent!;
  const origin = mount.getWorldPosition(new THREE.Vector3());
  const axis = j.axis.clone().transformDirection(mount.matrixWorld).normalize();
  if (j.cfg.kind === "prismatic") {
    const along = (r: THREE.Ray) => {
      // Closest point on the slide line to the ray.
      const w0 = new THREE.Vector3().subVectors(origin, r.origin);
      const b = axis.dot(r.direction);
      const d = axis.dot(w0);
      const e = r.direction.dot(w0);
      const den = 1 - b * b;
      if (Math.abs(den) < 1e-6) return null;
      return (b * e - d) / den;
    };
    const a = along(from);
    const b = along(to);
    return a === null || b === null ? null : (b - a) / chain.scale;
  }
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, origin);
  const pa = from.intersectPlane(plane, new THREE.Vector3());
  const pb = to.intersectPlane(plane, new THREE.Vector3());
  if (!pa || !pb) return null;
  const va = pa.sub(origin);
  const vb = pb.sub(origin);
  if (va.lengthSq() < 1e-12 || vb.lengthSq() < 1e-12) return null;
  const angle = Math.atan2(new THREE.Vector3().crossVectors(va, vb).dot(axis), va.dot(vb));
  return angle / DEG;
}

/** Set every joint to its value (deg / mm); missing values leave the joint unchanged. */
export function applyPose(chain: Chain, values: Record<string, number | undefined>) {
  for (const [id, j] of chain.joints) {
    const q = values[id];
    if (q === undefined || !Number.isFinite(q)) continue;
    if (j.cfg.kind === "prismatic") j.joint.position.copy(j.axis).multiplyScalar(q * chain.scale);
    else j.joint.quaternion.setFromAxisAngle(j.axis, q * DEG);
  }
}
