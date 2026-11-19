import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { AxisConfig, AxisGeometry } from "../../types/api";
import { COLLISION_MARGIN_MM, checkPath, checkSweep, clearance, forwardKinematics, hasCollisionModel, kinematicTree, mul, position, rpy, segmentDistance, translate, type Vec3 } from "./kinematics";
import { applyPose, axisOf, buildChain, dragDelta } from "./scene";

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

describe("Dummy arm profile (motioncore robot-profiles/dummy-arm-virtual.toml)", () => {
  // Geometry converted from the Dummy robot's DH table; expected flange
  // positions computed with that robot's own forward kinematics.
  const dummy = (): AxisConfig[] => [
    axis("j1", "revolute", {}),
    axis("j2", "revolute", { parent: "j1", origin_mm: [35, 0, 109], rotation_deg: [0, -90, -90] }),
    axis("j3", "revolute", { parent: "j2", origin_mm: [146, 0, 0], rotation_deg: [0, 0, 90] }),
    axis("j4", "revolute", { parent: "j3", origin_mm: [-52, -115, 0], rotation_deg: [90, 0, 0] }),
    axis("j5", "revolute", { parent: "j4", rotation_deg: [-90, 0, 0] }),
    axis("j6", "revolute", { parent: "j5", rotation_deg: [90, 0, 0], tip_mm: [0, 0, 72] }),
  ];
  const flange = (q: Record<string, number>) => tipOf(forwardKinematics(dummy(), q), "j6", [0, 0, 72]);

  it("stands straight up at zero", () => {
    expect(near(flange({}), [-17, 0, 442], 1e-6)).toBe(true);
  });
  it("folds into its rest pose", () => {
    expect(near(flange({ j1: 0, j2: -73, j3: 180, j4: 0, j5: 0, j6: 0 }), [89.41, 0, 146.74], 0.01)).toBe(true);
  });
});

describe("picking and dragging", () => {
  const chain = () => buildChain(railArm(), { body: new THREE.MeshBasicMaterial(), fixed: new THREE.MeshBasicMaterial() })!;

  it("maps every part to the joint that moves it", () => {
    const c = chain();
    const ids = new Map<string, Set<string>>();
    c.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const id = axisOf(o)!;
      expect(id).not.toBeNull();
      ids.set(id, (ids.get(id) ?? new Set()).add(o.type));
    });
    expect([...ids.keys()].sort()).toEqual(["j1", "j2", "x"]);
    // The elbow's own hub is tagged j2, the shoulder link (moved by j1) j1.
    const hubOf = (id: string) => c.joints.get(id)!.joint.children[0]!;
    expect(axisOf(hubOf("j2"))).toBe("j2");
    expect(axisOf(hubOf("j1"))).toBe("j1");
  });

  /** Vertical rays (along robot -Z) through robot-frame points around a joint. */
  function rayThrough(c: ReturnType<typeof chain>, robotMm: Vec3): THREE.Ray {
    c.root.updateMatrixWorld(true);
    const p = c.root.localToWorld(new THREE.Vector3(...robotMm).multiplyScalar(c.scale));
    const up = new THREE.Vector3(0, 0, 1).transformDirection(c.root.matrixWorld);
    return new THREE.Ray(p.clone().addScaledVector(up, 5), up.clone().negate());
  }

  it("turns a quarter-turn drag around the shoulder into +90°", () => {
    const c = chain();
    for (const x of [0, 200]) {
      applyPose(c, { x, j1: 0, j2: 0 });
      const from = rayThrough(c, [x + 100, 0, 120]);
      const to = rayThrough(c, [x, 100, 120]);
      expect(dragDelta(c, "j1", from, to)).toBeCloseTo(90, 6);
      expect(dragDelta(c, "j1", to, from)).toBeCloseTo(-90, 6);
    }
  });

  it("turns a drag along the rail into millimetres", () => {
    const c = chain();
    applyPose(c, { x: 100 });
    expect(dragDelta(c, "x", rayThrough(c, [100, 30, 0]), rayThrough(c, [175, 30, 0]))).toBeCloseTo(75, 6);
  });

  it("returns null for unknown axes", () => {
    expect(dragDelta(chain(), "nope", new THREE.Ray(), new THREE.Ray())).toBeNull();
  });
});

describe("collision model (same as the engine)", () => {
  const R = { j1: 30, j2: 22, j3: 20, j4: 18, j5: 18, j6: 15 };
  const arm = (): AxisConfig[] => [
    axis("j1", "revolute", { radius_mm: R.j1 }),
    axis("j2", "revolute", { parent: "j1", origin_mm: [35, 0, 109], rotation_deg: [0, -90, -90], radius_mm: R.j2 }),
    axis("j3", "revolute", { parent: "j2", origin_mm: [146, 0, 0], rotation_deg: [0, 0, 90], radius_mm: R.j3 }),
    axis("j4", "revolute", { parent: "j3", origin_mm: [-52, -115, 0], rotation_deg: [90, 0, 0], radius_mm: R.j4 }),
    axis("j5", "revolute", { parent: "j4", rotation_deg: [-90, 0, 0], radius_mm: R.j5 }),
    axis("j6", "revolute", { parent: "j5", rotation_deg: [90, 0, 0], tip_mm: [0, 0, 72], radius_mm: R.j6 }),
  ];
  const q = (...v: number[]) => Object.fromEntries(v.map((x, i) => [`j${i + 1}`, x]));

  it("segment distance", () => {
    expect(segmentDistance([0, 0, 0], [2, 0, 0], [1, -1, 1], [1, 1, 1])).toBeCloseTo(1, 12);
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [3, 0, 0], [4, 0, 0])).toBeCloseTo(2, 12);
  });

  it("needs a radius on every axis", () => {
    expect(hasCollisionModel(arm())).toBe(true);
    expect(hasCollisionModel(railArm())).toBe(false);
    expect(clearance(railArm(), {})).toBeNull();
  });

  it("matches the known poses", () => {
    expect(clearance(arm(), q(0, 0, 90, 0, 0, 0))!.gap).toBeGreaterThan(50);
    // Independent Python analysis of the same model: about 7 mm at rest.
    expect(clearance(arm(), q(0, -73, 180, 0, 0, 0))!.gap).toBeCloseTo(7, 0);
    const bad = clearance(arm(), q(-170, -73, 180, -180, -120, -720))!;
    expect([bad.a, bad.b]).toEqual(["j2", "j6"]);
    expect(bad.gap).toBeLessThan(0);
    expect(clearance(arm(), q(0, 90, 90, 0, 0, 0))!.b).toBe("floor");
  });

  it("finds the first contact of a sweep, and lets the arm back out", () => {
    const rest = q(0, -73, 180, 0, 0, 0);
    const c = checkSweep(arm(), rest, "j5", 60)!;
    expect(c.b).toBe("j6");
    expect(c.at.j5).toBeGreaterThan(0);
    expect(c.at.j5).toBeLessThan(30);
    expect(checkSweep(arm(), rest, "j5", -60)).toBeNull();
    const into = q(0, -73, 180, 0, 25, 0);
    expect(clearance(arm(), into)!.gap).toBeLessThan(COLLISION_MARGIN_MM);
    expect(checkSweep(arm(), into, "j5", 0)).toBeNull();
    expect(checkSweep(arm(), into, "j5", 40)).not.toBeNull();
  });

  it("checks the straight joint-space path of a multi-joint move (as the engine does)", () => {
    // Both ends are well clear; the path swings the flange through the base.
    const a = q(-120, 20, 180, 130, 80, -10);
    const b = { j1: 150, j2: -35, j3: 150, j4: -145, j5: 60, j6: 465 };
    expect(clearance(arm(), a)!.gap).toBeGreaterThan(10);
    expect(clearance(arm(), { ...a, ...b })!.gap).toBeGreaterThan(10);
    const c = checkPath(arm(), a, b)!;
    expect([c.a, c.b]).toEqual(["j1", "j6"]);
    expect(checkPath(arm(), q(0, 0, 0, 0, 0, 0), { j1: 35, j3: 90, j4: 30, j5: -50, j6: 90 })).toBeNull();
  });

  it("backs out only if it does not end closer than it started", () => {
    const into = q(0, -73, 180, 0, 25, 0);
    const c = checkSweep(arm(), into, "j5", 25.05)!;
    expect(c).not.toBeNull();
    expect(c.between).toBeUndefined();
    expect(c.gap).toBeLessThan(clearance(arm(), into)!.gap);
  });

  // A post at the origin and a 1977.5 mm arm pivoting at x = -2000 whose tip
  // passes `pass` mm from the post at 0°: a 0.5° step moves the tip 17 mm.
  const swing = (pass: number): AxisConfig[] => [
    axis("post", "revolute", { tip_mm: [0, 0, 500], radius_mm: 10 }),
    axis("arm", "revolute", { origin_mm: [-2000, 0, 250], tip_mm: [1980 - pass, 0, 0], radius_mm: 10 }),
  ];

  it("finds a contact between the poses a fixed 0.5° grid would check (as the engine does)", () => {
    for (let k = 0; k <= 40; k++) expect(clearance(swing(0.5), { post: 0, arm: -10.25 + 0.5 * k })!.gap).toBeGreaterThan(COLLISION_MARGIN_MM);
    expect(clearance(swing(0.5), { post: 0, arm: 0 })!.gap).toBeCloseTo(0.5, 9);
    const c = checkPath(swing(0.5), { post: 0, arm: -10.25 }, { arm: 9.75 })!;
    expect(c.gap).toBeLessThan(COLLISION_MARGIN_MM);
    expect(Math.abs(c.at.arm!)).toBeLessThan(0.25);
    expect(checkPath(swing(3), { post: 0, arm: -10.25 }, { arm: 9.75 })).toBeNull();
  });

  it("accepted paths keep the margin at densely resampled poses", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const lim: [number, number][] = [[-170, 170], [-73, 90], [35, 180], [-180, 180], [-120, 120], [-720, 720]];
    let accepted = 0;
    for (let n = 0; n < 40; n++) {
      const from = q(...lim.map(([lo, hi]) => lo + (hi - lo) * rnd()));
      if (clearance(arm(), from)!.gap < COLLISION_MARGIN_MM) continue;
      const targets: Record<string, number> = {};
      lim.forEach(([lo, hi], i) => {
        if (rnd() < 0.5) targets[`j${i + 1}`] = Math.min(hi, Math.max(lo, from[`j${i + 1}`]! + 60 * (rnd() - 0.5)));
      });
      if (checkPath(arm(), from, targets)) continue;
      accepted++;
      const ids = Object.keys(targets);
      const steps = Math.max(1, Math.ceil(Math.max(0, ...ids.map((id) => Math.abs(targets[id]! - from[id]!) / 0.01))));
      for (let k = 0; k <= steps; k += 1) {
        const pose = { ...from };
        for (const id of ids) pose[id] = from[id]! + ((targets[id]! - from[id]!) * k) / steps;
        expect(clearance(arm(), pose)!.gap).toBeGreaterThanOrEqual(COLLISION_MARGIN_MM - 1e-9);
      }
    }
    expect(accepted).toBeGreaterThan(5);
  });
});
