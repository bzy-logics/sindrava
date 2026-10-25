import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HISTORY_WINDOW_MS, live } from "../../hooks/liveStore";
import { useEngine } from "../../hooks/useEngine";
import { Empty, Led, Row, txt } from "../../components/common";
import type { LogLevel, McuStatus } from "../../types/api";

const SERIES_COLORS = ["#4fa3ff", "#f2b84b", "#7dffb0", "#d98cff", "#ff8a7a", "#5ad1e0"];

export function Diagnostics() {
  const s = useEngine();
  return (
    <div className="diag-grid">
      <McuPanel mcu={s.telemetry?.mcu ?? null} stale={!s.engineConnected} />
      <section className="panel chart-panel">
        <h2>Position · last 30 s</h2>
        <PositionChart />
      </section>
      <LogPanel />
    </div>
  );
}

function McuPanel({ mcu, stale }: { mcu: McuStatus | null; stale: boolean }) {
  if (!mcu)
    return (
      <section className="panel">
        <h2>MCU</h2>
        <Empty>No telemetry.</Empty>
      </section>
    );
  const qPct = mcu.queue_capacity > 0 ? (mcu.queue_depth / mcu.queue_capacity) * 100 : 0;
  return (
    <section className={`panel mcu-panel ${stale ? "stale" : ""}`}>
      <h2>
        MCU <Led on={mcu.connected} label={mcu.connected ? "connected" : "disconnected"} color="ok" />
      </h2>
      <dl className="kv">
        <Row k="Transport" v={txt(mcu.transport)} />
        <Row k="Target" v={txt(mcu.target)} />
        <Row k="Board" v={txt(mcu.board)} />
        <Row k="Firmware" v={txt(mcu.firmware_version)} />
        <Row k="Build hash" v={<span className="mono">{txt(mcu.build_hash)}</span>} />
        <Row k="Protocol" v={`v${mcu.protocol_version}`} />
        <Row k="Clock offset" v={`${mcu.clock_offset_us} µs`} />
        <Row k="RTT" v={`${mcu.rtt_us} µs`} warn={mcu.rtt_us > 5000} />
        <Row k="TX frames" v={mcu.tx_frames.toLocaleString()} />
        <Row k="RX frames" v={mcu.rx_frames.toLocaleString()} />
        <Row k="CRC errors" v={mcu.crc_errors} warn={mcu.crc_errors > 0} />
        <Row k="Heartbeat age" v={mcu.last_heartbeat_ms_ago === null ? "—" : `${mcu.last_heartbeat_ms_ago} ms`} warn={mcu.last_heartbeat_ms_ago !== null && mcu.last_heartbeat_ms_ago > 500} />
      </dl>
      <div className="queue">
        <div className="queue-label">
          <span className="label">Queue</span>
          <span className="mono">
            {mcu.queue_depth} / {mcu.queue_capacity}
          </span>
        </div>
        <div className="bar">
          <div className={`bar-fill ${qPct > 85 ? "bar-hot" : ""}`} style={{ width: `${qPct}%` }} />
        </div>
      </div>
      <div className="caps">
        {mcu.capabilities.length === 0 ? <span className="muted small">no capabilities</span> : mcu.capabilities.map((c) => <span key={c} className="chip">{c}</span>)}
      </div>
    </section>
  );
}

function PositionChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const s = useEngine();
  const units = new Map((s.config?.axes ?? []).map((a) => [a.id, a.unit]));
  const ids = [...new Set([...(s.config?.axes.map((a) => a.id) ?? []), ...(s.telemetry?.axes.map((a) => a.id) ?? [])])];
  const idsRef = useRef(ids);
  idsRef.current = ids;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const now = performance.now();
      const t0 = now - HISTORY_WINDOW_MS;
      let lo = Infinity;
      let hi = -Infinity;
      for (const buf of live.history.values())
        for (const p of buf) {
          if (p.t < t0) continue;
          lo = Math.min(lo, p.measured, p.commanded);
          hi = Math.max(hi, p.measured, p.commanded);
        }
      const padL = 44;
      const padR = 8;
      const padY = 10;
      const pw = w - padL - padR;
      const ph = h - padY * 2;

      // grid
      ctx.strokeStyle = "rgba(140,160,190,0.12)";
      ctx.fillStyle = "rgba(160,175,200,0.7)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        const x = padL + (pw * i) / 6;
        ctx.beginPath();
        ctx.moveTo(x, padY);
        ctx.lineTo(x, padY + ph);
        ctx.stroke();
      }
      if (!Number.isFinite(lo)) {
        ctx.fillText("waiting for telemetry…", padL + 8, padY + 16);
        return;
      }
      if (hi - lo < 1e-6) {
        lo -= 1;
        hi += 1;
      }
      const margin = (hi - lo) * 0.08;
      lo -= margin;
      hi += margin;
      const X = (t: number) => padL + ((t - t0) / HISTORY_WINDOW_MS) * pw;
      const Y = (v: number) => padY + ph - ((v - lo) / (hi - lo)) * ph;
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const v = lo + ((hi - lo) * i) / 4;
        const y = Y(v);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + pw, y);
        ctx.stroke();
        ctx.fillText(v.toFixed(Math.abs(hi - lo) < 10 ? 2 : 0), padL - 4, y + 4);
      }
      ctx.textAlign = "left";

      idsRef.current.forEach((id, ci) => {
        const buf = live.history.get(id);
        if (!buf) return;
        const color = SERIES_COLORS[ci % SERIES_COLORS.length]!;
        // commanded: dashed, thin
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = color + "88";
        line(ctx, buf, t0, X, Y, "commanded");
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        line(ctx, buf, t0, X, Y, "measured");
      });
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="chart" />
      <div className="chart-legend">
        {ids.map((id, i) => (
          <span key={id} className="legend-row small">
            <span className="swatch" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            {id} {units.get(id) ? `(${units.get(id)})` : ""}
          </span>
        ))}
        <span className="muted small">solid = measured · dashed = commanded</span>
      </div>
    </>
  );
}

function line(
  ctx: CanvasRenderingContext2D,
  buf: { t: number; measured: number; commanded: number }[],
  t0: number,
  X: (t: number) => number,
  Y: (v: number) => number,
  key: "measured" | "commanded",
) {
  ctx.beginPath();
  let started = false;
  for (const p of buf) {
    if (p.t < t0) continue;
    const x = X(p.t);
    const y = Y(p[key]);
    if (started) ctx.lineTo(x, y);
    else {
      ctx.moveTo(x, y);
      started = true;
    }
  }
  ctx.stroke();
}

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function LogPanel() {
  const { logs } = useEngine();
  const [minLevel, setMinLevel] = useState<LogLevel>("debug");
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = logs.filter((l) => LEVELS.indexOf(l.level) >= LEVELS.indexOf(minLevel));

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown.length, follow, logs]);

  return (
    <section className="panel log-panel">
      <div className="log-head">
        <h2>Log</h2>
        <div className="log-tools">
          <select value={minLevel} onChange={(e) => setMinLevel(e.target.value as LogLevel)} aria-label="Minimum level">
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                ≥ {l}
              </option>
            ))}
          </select>
          <label className="small">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
          </label>
          <button className="btn btn-small" onClick={() => live.clearLogs()}>
            Clear
          </button>
        </div>
      </div>
      <div className="log-list" ref={listRef}>
        {shown.length === 0 ? (
          <Empty>No log entries.</Empty>
        ) : (
          shown.map((l, i) => (
            <div key={i} className={`log-line log-${l.level}`}>
              <span className="log-time">{(l.time_ms / 1000).toFixed(3)}</span>
              <span className="log-level">{l.level}</span>
              <span className="log-msg">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
