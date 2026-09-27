import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AxisConfig } from "../../types/api";
import { live } from "../../hooks/liveStore";
import { useEngine } from "../../hooks/useEngine";
import { fmt } from "../../components/common";
import { mergeAxes } from "./axes";

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

/** 3D view: measured pose solid, planned (commanded) pose as a translucent ghost. Lazy-loaded (three.js). */
export default function Viewer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const s = useEngine();
  const axes = mergeAxes(s.config?.axes ?? null, s.telemetry?.axes ?? []);
  // Rebuild the scene only when the set/kind of axes changes.
  const axesKey = axes.map((a) => `${a.id}:${a.cfg?.kind ?? "?"}:${a.cfg?.min ?? ""}:${a.cfg?.max ?? ""}`).join("|");

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
    const visuals = buildAxes(
      robot,
      axes.map((a) => ({ id: a.id, cfg: a.cfg })),
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.5, 0);
    controls.update();

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

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const tel = live.getState().telemetry;
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
        <div className="legend-row">
          <span className="swatch swatch-limit" /> soft limit
        </div>
        {axes.map((a) => (
          <div key={a.id} className="legend-row mono small">
            {a.id}: {fmt(a.tel?.measured_position)} / {fmt(a.tel?.commanded_position)} {a.cfg?.unit ?? ""}
          </div>
        ))}
        <div className="muted small">Drag to orbit · wheel to zoom · right-drag to pan</div>
      </div>
    </div>
  );
}
