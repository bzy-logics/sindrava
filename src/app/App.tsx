import { Suspense, lazy, useEffect, useState } from "react";
import { live } from "../hooks/liveStore";
import { useEngine, useTelemetry } from "../hooks/useEngine";
import { useCommand } from "../hooks/useCommand";
import { StateBadge } from "../components/common";
import { Dashboard } from "../features/dashboard/Dashboard";
import { MotionControl } from "../features/motion/MotionControl";
import { RobotConfigView } from "../features/robots/RobotConfig";
import { Composer } from "../features/composer/Composer";
import { Firmware } from "../features/firmware/Firmware";
import { Plugins } from "../features/plugins/Plugins";
import { Diagnostics } from "../features/diagnostics/Diagnostics";
import { AuthBanner, ConnectionBanner } from "./Banners";
import { Settings } from "./Settings";
import { TABS, tabFromHash, type TabId } from "./tabs";

// three.js is large; the 3D viewer is loaded on demand.
const Viewer = lazy(() => import("../features/motion/Viewer"));

export function App() {
  const [tab, setTab] = useState<TabId>(() => tabFromHash(window.location.hash));

  useEffect(() => {
    live.start();
    return () => live.stop();
  }, []);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = (id: TabId) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <div className="app">
      <Header />
      <nav className="nav" aria-label="Screens">
        {TABS.map((t) => (
          <button key={t.id} className={`nav-btn ${tab === t.id ? "active" : ""}`} onClick={() => select(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            {t.label}
          </button>
        ))}
      </nav>

      <AuthBanner />
      <ConnectionBanner />

      <main className="main">
        {tab === "dashboard" && <Dashboard />}
        {tab === "motion" && <MotionControl />}
        {tab === "viewer" && (
          <Suspense fallback={<div className="empty">Loading 3D viewer…</div>}>
            <Viewer />
          </Suspense>
        )}
        {tab === "robot" && <RobotConfigView />}
        {tab === "composer" && <Composer />}
        {tab === "firmware" && <Firmware />}
        {tab === "plugins" && <Plugins />}
        {tab === "diagnostics" && <Diagnostics />}
        {tab === "settings" && <Settings />}
      </main>
    </div>
  );
}

function Header() {
  const s = useEngine();
  const { state } = useTelemetry();
  const run = useCommand();
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ◎
        </span>
        <span className="brand-name">MotionCore</span>
        {s.config && <span className="brand-robot">{s.config.name}</span>}
      </div>
      <div className="header-status">
        <StateBadge state={state} />
        <span className={`link link-${s.link}`} title="Dashboard ↔ API WebSocket">
          {s.link === "open" ? "live" : s.link}
        </span>
      </div>
      {/* Always rendered and never disabled; the server validates and relays it. */}
      <button className="estop" onClick={() => void run("estop", {})} title="Emergency stop (software)">
        E-STOP
      </button>
    </header>
  );
}
