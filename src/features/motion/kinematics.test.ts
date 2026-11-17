import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { AxisConfig, AxisGeometry } from "../../types/api";
import { forwardKinematics, kinematicTree, mul, position, rpy, translate, type Vec3 } from "./kinematics";
import { applyPose, buildChain } from "./scene";

function axis(id: string, kind: AxisConfig["kind"], geometry: Partial<AxisGeometry> | null, min = -180, max = 180): AxisConfig {
  return {
    id,
    name: id,
    kind,
    unit: kind === "revolute" ? "deg" : "mm",
    min,
    max,
    max_velocity: 90,
    max_acceleration: 360,
    home_position: null,
    steps_per_unit: 1,
    mcu: "main",
    mcu_channel: 0,
    actuator: "a",
    step_pin: "S",
    dir_pin: "D",
    enable_pin: "E",
    endstop_pin: null,
    geometry: geometry && { parent: null, origin_mm: [0, 0, 0], rotation_deg: [0, 0, 0], axis: [0, 0, 1], tip_mm: null, ...geometry },
  };
}

/** robot-profiles/rail-arm-virtual.toml in motioncore. */
const railArm = (): AxisConfig[] => [
  axis("x", "prismatic", { axis: [1, 0, 0] }, 0, 600),
  axis("j1", "revolute", { parent: "x", origin_mm: [0, 0, 120] }),
  axis("j2", "revolute", { parent: "j1", origin_mm: [250, 0, 0], tip_mm: [200, 0, 0] }),
];

const near = (a: Vec3, b: Vec3, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]!) < eps);
const tipOf = (frames: Map<string, number[]>, id: string, tip: Vec3): Vec3 => position(mul(frames.get(id)!, translate(tip)));

describe("kinematicTree", () => {
  it("orders parents before children", () => {
    const t = kinematicTree([...railArm()].reverse());
    expect(t.ok && t.order.map((a) => a.id)).toEqual(["x", "j1", "j2"]);
  });
  it("rejects missing, unknown and cyclic geometry", () => {
    expect(kinematicTree([axis("a", "revolute", null)])).toEqual({ ok: false, reason: "the robot profile defines no geometry" });
    expect(kinematicTree([axis("a", "revolute", {}), axis("b", "revolute", null)]).ok).toBe(false);
    expect(kinematicTree([axis("a", "revolute", { parent: "zz" })]).ok).toBe(false);
    expect(kinematicTree([axis("a", "revolute", { parent: "b" }), axis("b", "revolute", { parent: "a" })])).toEqual({
      ok: false,
      reason: "the parent chain forms a cycle",
    });
  });
});

describe("forwardKinematics (URDF convention)", () => {
  it("places the rail-arm joints", () => {
    const f = forwardKinematics(railArm(), { x: 100, j1: 90, j2: 0 });
    expect(near(position(f.get("x")!), [100, 0, 0])).toBe(true);
    expect(near(position(f.get("j1")!), [100, 0, 120])).toBe(true);
    // The elbow sits 250 mm out along the shoulder link, turned 90° about Z.
    expect(near(position(f.get("j2")!), [100, 250, 120])).toBe(true);
    expect(near(tipOf(f, "j2", [200, 0, 0]), [100, 450, 120])).toBe(true);
    const bent = forwardKinematics(railArm(), { x: 100, j1: 90, j2: 90 });
    expect(near(tipOf(bent, "j2", [200, 0, 0]), [-100, 250, 120])).toBe(true);
  });
  it("applies roll, then pitch, then yaw about the fixed axes", () => {
    const apply = (m: number[], v: Vec3): Vec3 => position(mul(m, translate(v)));
    expect(near(apply(rpy([0, 0, 90]), [1, 0, 0]), [0, 1, 0])).toBe(true);
    expect(near(apply(rpy([90, 0, 0]), [0, 1, 0]), [0, 0, 1])).toBe(true);
    // Order matters: roll first sends Y to Z, then yaw leaves Z alone.
    expect(near(apply(rpy([90, 0, 90]), [0, 1, 0]), [0, 0, 1])).toBe(true);
  });
});

describe("three.js chain", () => {
  /** Joint/tip position in robot coordinates (mm), read back from the scene graph. */
  function sceneMm(chain: NonNullable<ReturnType<typeof buildChain>>, obj: THREE.Object3D, local = new THREE.Vector3()): Vec3 {
    chain.root.updateMatrixWorld(true);
    const world = obj.localToWorld(local.clone());
    const robot = chain.root.worldToLocal(world).divideScalar(chain.scale);
    return [robot.x, robot.y, robot.z];
  }

  it("matches forward kinematics for random poses, including fixed rotations", () => {
    const axes = [
      axis("base", "revolute", { origin_mm: [10, -20, 50], rotation_deg: [0, 0, 30] }),
      axis("lift", "prismatic", { parent: "base", origin_mm: [0, 0, 80], axis: [0, 0, 1] }, 0, 300),
      axis("wrist", "revolute", { parent: "lift", origin_mm: [150, 0, 0], rotation_deg: [90, -45, 10], axis: [0, 1, 0], tip_mm: [40, 5, 60] }),
    ];
    const chain = buildChain(axes, { body: new THREE.MeshBasicMaterial() })!;
    expect(chain).not.toBeNull();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 25; i++) {
      const q = { base: rnd() * 170, lift: (rnd() + 1) * 150, wrist: rnd() * 120 };
      applyPose(chain, q);
      const f = forwardKinematics(axes, q);
      for (const id of ["base", "lift", "wrist"]) {
        expect(near(sceneMm(chain, chain.joints.get(id)!.joint), position(f.get(id)!), 1e-6)).toBe(true);
      }
      const tipLocal = new THREE.Vector3(40, 5, 60).multiplyScalar(chain.scale);
      expect(near(sceneMm(chain, chain.joints.get("wrist")!.joint, tipLocal), tipOf(f, "wrist", [40, 5, 60]), 1e-6)).toBe(true);
    }
  });

  it("refuses incomplete geometry so the viewer can fall back", () => {
    expect(buildChain([axis("a", "revolute", null)], { body: new THREE.MeshBasicMaterial() })).toBeNull();
  });
});
