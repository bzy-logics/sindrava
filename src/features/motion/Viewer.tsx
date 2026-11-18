import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AxisConfig } from "../../types/api";
import { live } from "../../hooks/liveStore";
import { useEngine } from "../../hooks/useEngine";
import { fmt } from "../../components/common";
import { mergeAxes } from "./axes";
import { kinematicTree, type Contact } from "./kinematics";
import { pathContact, type JointTargets } from "./jointMove";
import { applyPose, axisOf, buildChain, dragDelta, type Chain } from "./scene";
import { JointPanel } from "./JointPanel";

const SPACING = 3.2;
const LINK_LEN = 2;
const RAIL_LEN = 4;
const DEG = Math.PI / 180;

interface AxisVisual {
  id: string;
  kind: "revolute" | "prismatic";
  cfg: AxisConfig | null;
  measured: THREE.Object3D;
  commanded: THREE.Object3D;
}

/** Map an axis-unit position to scene X along a prismatic rail. */
function railX(cfg: AxisConfig | null, v: number): number {
  if (!cfg || cfg.max <= cfg.min) return 0;
  const f = (v - cfg.min) / (cfg.max - cfg.min);
  return (Math.min(1, Math.max(0, f)) - 0.5) * RAIL_LEN;
}

function buildAxes(scene: THREE.Group, axes: { id: string; cfg: AxisConfig | null }[]): AxisVisual[] {
  const solid = new THREE.MeshStandardMaterial({ color: 0x4fa3ff, metalness: 0.2, roughness: 0.5 });
  const ghost = new THREE.MeshStandardMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.28, depthWrite: false });
  const base = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.3, roughness: 0.7 });
  const limitMat = new THREE.LineBasicMaterial({ color: 0xff6b5a });
  const stopMat = new THREE.MeshBasicMaterial({ color: 0xff6b5a });

  const visuals: AxisVisual[] = [];
  const x0 = -((axes.length - 1) * SPACING) / 2;

  axes.forEach(({ id, cfg }, i) => {
    const kind = cfg?.kind ?? "revolute";
    const root = new THREE.Group();
    root.position.x = x0 + i * SPACING;
    scene.add(root);

    if (kind === "revolute") {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.4, 32), base);
      pedestal.position.y = 0.2;
      root.add(pedestal);

      const mkLink = (mat: THREE.Material) => {
        const pivot = new THREE.Group();
        pivot.position.y = 0.55;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 32), mat);
        const link = new THREE.Mesh(new THREE.BoxGeometry(LINK_LEN, 0.18, 0.28), mat);
        link.position.x = LINK_LEN / 2;
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), mat);
        tip.position.x = LINK_LEN;
        pivot.add(hub, link, tip);
        return pivot;
      };
      const measured = mkLink(solid);
      const commanded = mkLink(ghost);
      commanded.scale.setScalar(1.04);
      root.add(measured, commanded);

      // Soft-limit rays on the ground.
      if (cfg) {
        for (const lim of [cfg.min, cfg.max]) {
          const a = lim * DEG;
          const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0.02, 0),
            new THREE.Vector3(Math.cos(a) * LINK_LEN * 1.1, 0.02, -Math.sin(a) * LINK_LEN * 1.1),
          ]);
          root.add(new THREE.Line(g, limitMat));
        }
      }
      visuals.push({ id, kind, cfg, measured, commanded });
    } else {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(RAIL_LEN + 0.4, 0.15, 0.4), base);
      rail.position.y = 0.075;
      root.add(rail);
      for (const end of [-1, 1]) {
        const stop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.5), stopMat);
        stop.position.set((end * RAIL_LEN) / 2, 0.15, 0);
        root.add(stop);
      }
      const mkCarriage = (mat: THREE.Material) => {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.6), mat);
        c.position.y = 0.3;
        return c;
      };
      const measured = mkCarriage(solid);
      const commanded = mkCarriage(ghost);
      commanded.scale.setScalar(1.06);
      root.add(measured, commanded);
      visuals.push({ id, kind, cfg, measured, commanded });
    }
  });
  return visuals;
}

function disposeTree(obj: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
    else if (mat) mats.add(mat);
  });
  mats.forEach((m) => m.dispose());
}

/**
 * 3D view: measured pose solid, planned (commanded) pose as a translucent
 * ghost. With geometry in the robot profile (engine-api >= 0.1.3) the axes are
 * drawn as one connected robot; without it each axis is shown on its own,
 * because the viewer must not invent how they are mounted. Lazy-loaded (three.js).
 */
export default function Viewer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const s = useEngine();
  const axes = mergeAxes(s.config?.axes ?? null, s.telemetry?.axes ?? []);
  const tree = s.config ? kinematicTree(s.config.axes) : null;
  // Rebuild the scene only when the set/kind/geometry of axes changes.
  const axesKey = axes
    .map((a) => `${a.id}:${a.cfg?.kind ?? "?"}:${a.cfg?.min ?? ""}:${a.cfg?.max ?? ""}:${JSON.stringify(a.cfg?.geometry ?? null)}`)
    .join("|");

  // Joint selected in the view, and the previewed pose: a target per joint
  // the operator has moved (several joints move together, as one MoveJ).
  // The render loop and pointer handlers read them through refs.
  const [selected, setSelected] = useState<string | null>(null);
  const [pose, setPose] = useState<JointTargets>({});
  const selectedRef = useRef(selected);
  const poseRef = useRef(pose);
  selectedRef.current = selected;
  poseRef.current = pose;
  const setTarget = (id: string, v: number | null) =>
    setPose((p) => {
      const { [id]: _, ...rest } = p;
      return v === null ? rest : { ...rest, [id]: v };
    });

  // Collision check of the previewed move (straight joint-space path), with
  // the engine's model; only when the engine checks too.
  const commandedKey = (s.telemetry?.axes ?? []).map((a) => `${a.id}=${a.commanded_position.toFixed(3)}:${a.homed}`).join("|");
  const contact: Contact | null = useMemo(() => pathContact(s.config, s.telemetry, pose), [pose, commandedKey, s.config]);
  const contactRef = useRef(contact);
  contactRef.current = contact;
  const select = (id: string | null) => setSelected(id);
  useEffect(() => {
    if (selected && !axes.some((a) => a.id === selected)) select(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [axesKey, selected]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0c0f14);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0c0f14, 18, 40);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    camera.position.set(4, 5, 7);

    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x20242c, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 10, 6);
    scene.add(sun);

    const grid = new THREE.GridHelper(20, 40, 0x2f3846, 0x1b212b);
    scene.add(grid);
    const axesHelper = new THREE.AxesHelper(1.2);
    axesHelper.position.y = 0.001;
    scene.add(axesHelper);

    const robot = new THREE.Group();
    scene.add(robot);
    // Connected robot when every axis has geometry, separate axes otherwise.
    const cfgs = axes.map((a) => a.cfg).filter((c): c is AxisConfig => c !== null);
    const solidMat = new THREE.MeshStandardMaterial({ color: 0x4fa3ff, metalness: 0.2, roughness: 0.5 });
    const ghostMat = new THREE.MeshStandardMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.28, depthWrite: false });
    const fixedMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.3, roughness: 0.7 });
    const limitMat = new THREE.MeshBasicMaterial({ color: 0xff6b5a });
    const previewMat = new THREE.MeshStandardMaterial({ color: 0xffb547, transparent: true, opacity: 0.45, depthWrite: false });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd400 });
    let chains: { measured: Chain; commanded: Chain; preview: Chain } | null = null;
    if (cfgs.length === axes.length) {
      const measured = buildChain(cfgs, { body: solidMat, fixed: fixedMat, limit: limitMat });
      const commanded = measured && buildChain(cfgs, { body: ghostMat }, measured.scale);
      const preview = measured && buildChain(cfgs, { body: previewMat }, measured.scale);
      if (measured && commanded && preview) {
        chains = { measured, commanded, preview };
        preview.root.visible = false;
        robot.add(measured.root, commanded.root, preview.root);
      }
    }
    if (!chains) [solidMat, ghostMat, fixedMat, limitMat, previewMat, ringMat].forEach((m) => m.dispose());
    // Selection marker: a ring around the selected joint's axis.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 8, 48), ringMat);
    ring.visible = false;
    let ringOn: string | null = null;
    const visuals = chains
      ? []
      : buildAxes(
          robot,
          axes.map((a) => ({ id: a.id, cfg: a.cfg })),
        );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.5, 0);
    controls.update();

    // ---- picking and dragging (connected robot only)
    const raycaster = new THREE.Raycaster();
    const rayAt = (e: PointerEvent): THREE.Ray => {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.clone();
    };
    const pick = (e: PointerEvent): string | null => {
      if (!chains) return null;
      rayAt(e);
      const hit = raycaster.intersectObject(chains.measured.root, true)[0];
      return hit ? axisOf(hit.object) : null;
    };
    const measuredOf = (id: string) => live.getState().telemetry?.axes.find((a) => a.id === id)?.measured_position ?? null;
    let down: { x: number; y: number; id: string | null } | null = null;
    let drag: { id: string; last: THREE.Ray; value: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const id = pick(e);
      down = { x: e.clientX, y: e.clientY, id };
      const sel = selectedRef.current;
      const base = sel ? (poseRef.current[sel] ?? measuredOf(sel)) : null;
      if (chains && id !== null && id === sel && base !== null) {
        drag = { id, last: rayAt(e), value: base };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (drag && chains) {
        const now = rayAt(e);
        const d = dragDelta(chains.measured, drag.id, drag.last, now);
        if (d !== null) {
          const cfg = chains.measured.joints.get(drag.id)!.cfg;
          drag.value = Math.min(cfg.max, Math.max(cfg.min, drag.value + d));
          drag.last = now;
          setTarget(drag.id, Math.round(drag.value * 100) / 100);
        }
        return;
      }
      const over = pick(e);
      renderer.domElement.style.cursor = over ? (over === selectedRef.current ? "grab" : "pointer") : "";
    };
    const onUp = (e: PointerEvent) => {
      if (drag) {
        drag = null;
        controls.enabled = true;
      } else if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && down.id) {
        // A click (not an orbit drag) on a part selects its joint.
        if (down.id !== selectedRef.current) select(down.id);
      }
      down = null;
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // A connected robot is framed once its first pose is known; the
    // separate-axes layout keeps the fixed camera.
    let framed = chains === null;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const tel = live.getState().telemetry;
      if (chains && tel) {
        const measuredPose = Object.fromEntries(tel.axes.map((a) => [a.id, a.measured_position]));
        applyPose(chains.measured, measuredPose);
        applyPose(chains.commanded, Object.fromEntries(tel.axes.map((a) => [a.id, a.commanded_position])));
        const sel = selectedRef.current;
        const pv = poseRef.current;
        const previewing = Object.keys(pv).length > 0;
        chains.preview.root.visible = previewing;
        previewMat.color.setHex(contactRef.current ? 0xff4d4d : 0xffb547);
        if (previewing) applyPose(chains.preview, { ...measuredPose, ...pv });
        if (sel !== ringOn) {
          ringOn = sel;
          ring.removeFromParent();
          const j = sel ? chains.measured.joints.get(sel) : undefined;
          ring.visible = !!j;
          if (j) {
            j.joint.add(ring);
            // Torus lies in its XY plane: turn its normal (Z) onto the joint axis.
            ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), j.axis);
          }
        }
        if (!framed) {
          framed = true;
          robot.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(chains.measured.root);
          const center = box.getCenter(new THREE.Vector3());
          const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
          controls.target.copy(center);
          camera.position.copy(center).add(new THREE.Vector3(0.55, 0.6, 0.9).normalize().multiplyScalar(size * 1.4));
        }
      }
      for (const v of visuals) {
        const a = tel?.axes.find((x) => x.id === v.id);
        if (!a) continue;
        if (v.kind === "revolute") {
          v.measured.rotation.y = a.measured_position * DEG;
          v.commanded.rotation.y = a.commanded_position * DEG;
        } else {
          v.measured.position.x = railX(v.cfg, a.measured_position);
          v.commanded.position.x = railX(v.cfg, a.commanded_position);
        }
      }
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      ring.geometry.dispose();
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    // Rebuild only when the axis set changes (axesKey), not on every telemetry frame.
  }, [axesKey]);

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={hostRef} />
      <div className="viewer-legend panel">
        <div className="legend-row">
          <span className="swatch swatch-solid" /> measured
        </div>
        <div className="legend-row">
          <span className="swatch swatch-ghost" /> planned (commanded)
        </div>
        {(!tree?.ok || axes.some((a) => a.cfg?.kind === "prismatic")) && (
          <div className="legend-row">
            <span className="swatch swatch-limit" /> {tree?.ok ? "rail travel limit" : "soft limit"}
          </div>
        )}
        <div className="muted small viewer-mode">
          {tree?.ok
            ? "Connected robot from the profile's geometry."
            : "Axes shown separately: the robot profile has no geometry ([axis.geometry]), so how they are mounted is unknown."}
        </div>
        {tree?.ok && (
          <div className="legend-row">
            <span className="swatch swatch-preview" /> preview (not sent)
          </div>
        )}
        {axes.map((a) => (
          <button
            key={a.id}
            className={`legend-row legend-axis mono small ${selected === a.id ? "active" : ""}`}
            onClick={() => select(selected === a.id ? null : a.id)}
            aria-pressed={selected === a.id}
            title="Select this joint"
          >
            {a.id}: {fmt(a.tel?.measured_position)} / {fmt(a.tel?.commanded_position)} {a.cfg?.unit ?? ""}
            {pose[a.id] !== undefined && <span className="preview-text"> → {fmt(pose[a.id])}</span>}
          </button>
        ))}
        {Object.keys(pose).length > 0 && (
          <button className="btn btn-small" onClick={() => setPose({})}>
            Clear preview ({Object.keys(pose).length} {Object.keys(pose).length === 1 ? "joint" : "joints"})
          </button>
        )}
        <div className="muted small">
          {tree?.ok ? "Click a joint to select it, then drag it to preview a move; preview several joints to move them together. " : "Select a joint above. "}
          Drag elsewhere to orbit · wheel to zoom · right-drag to pan · Esc to deselect
        </div>
      </div>
      {selected && (
        <JointPanel
          id={selected}
          cfg={axes.find((a) => a.id === selected)?.cfg ?? null}
          tel={axes.find((a) => a.id === selected)?.tel ?? null}
          preview={pose[selected] ?? null}
          onPreview={(v) => setTarget(selected, v)}
          onClose={() => select(null)}
          contact={contact}
          others={pose}
          onClearAll={() => setPose({})}
        />
      )}
    </div>
  );
}
