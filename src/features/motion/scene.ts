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
  const r = 0.09; // link radius, scene units

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
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 2, r * 2, r * 3, 24), mats.body);
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
      const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 1.6, 16, 12), mats.body);
      tip.position.set(g.tip_mm[0] * scale, g.tip_mm[1] * scale, g.tip_mm[2] * scale);
      joint.add(tip);
    }
    joints.set(a.id, { cfg: a, joint, axis });
  }
  return { root, joints, scale };
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
