import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useTelemetry } from "../hooks/useEngine";
import { evaluateEstop, type EstopPhase } from "../hooks/status";

/**
 * Software emergency stop. Always enabled (the server decides), never
 * confirms anything on its own: "confirmed" is shown only once engine
 * telemetry reports emergency_stopped. A failed or unconfirmed request tells
 * the operator to use the hardware E-stop.
 */
export function EstopButton() {
  const { telemetry, online } = useTelemetry();
  const state = telemetry?.state ?? null;
  const [phase, setPhase] = useState<EstopPhase>({ kind: "idle" });

  // Follow the engine while a request is in flight (and time it out).
  useEffect(() => {
    if (phase.kind !== "sending" && phase.kind !== "awaiting") return;
    const tick = () => setPhase((p) => evaluateEstop(p, state, online, performance.now()));
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [phase.kind, state, online]);

  // Once the robot leaves emergency_stopped (fault reset), the message is done.
  useEffect(() => {
    if (phase.kind === "confirmed" && online && state !== "emergency_stopped") setPhase({ kind: "idle" });
  }, [phase.kind, state, online]);

  const send = async () => {
    setPhase({ kind: "sending", at: performance.now() });
    try {
      await api.command("estop", {});
      // Accepted by the engine; confirmation comes from telemetry.
      setPhase((p) => (p.kind === "sending" ? { kind: "awaiting", at: performance.now() } : p));
    } catch (e) {
      const reason = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
      setPhase({ kind: "failed", at: performance.now(), reason });
    }
  };

  return (
    <div className="estop-wrap">
      <button className="estop" onClick={() => void send()} title="Software emergency stop — not a substitute for the hardware E-stop">
        E-STOP
      </button>
      <EstopStatus phase={phase} />
    </div>
  );
}

function EstopStatus({ phase }: { phase: EstopPhase }) {
  switch (phase.kind) {
    case "idle":
      return <span className="estop-note">software stop · not a hardware E-stop</span>;
    case "sending":
      return (
        <span className="estop-note" role="status">
          E-STOP sent…
        </span>
      );
    case "awaiting":
      return (
        <span className="estop-note" role="status">
          Accepted, waiting for engine confirmation…
        </span>
      );
    case "confirmed":
      return (
        <span className="estop-note estop-ok" role="status">
          E-STOP confirmed by engine
        </span>
      );
    case "failed":
      return (
        <span className="estop-note estop-bad" role="alert">
          E-STOP FAILED ({phase.reason}). Use the hardware emergency stop.
        </span>
      );
    case "unconfirmed":
      return (
        <span className="estop-note estop-bad" role="alert">
          No confirmation from the engine. Use the hardware emergency stop.
        </span>
      );
  }
}
