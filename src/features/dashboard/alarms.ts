import type { Plugin, ServerInfo, Telemetry } from "../../types/api";

export interface Alarm {
  severity: "err" | "warn" | "info";
  title: string;
  detail?: string;
}

/**
 * Operator-facing alarms derived from what the server reports. These are
 * display hints only; the engine's state/fault is authoritative.
 */
export function deriveAlarms(input: {
  engineConnected: boolean;
  telemetry: Telemetry | null;
  plugins: Plugin[] | null;
  info: ServerInfo | null;
}): Alarm[] {
  const out: Alarm[] = [];
  const { telemetry: t } = input;
  if (!input.engineConnected) out.push({ severity: "err", title: "Engine disconnected", detail: "Displayed values are stale." });
  if (t?.fault) {
    out.push({ severity: "err", title: `Fault: ${t.fault.code}`, detail: t.fault.message + (t.fault.axis ? ` (axis ${t.fault.axis})` : "") });
  } else if (t && (t.state === "faulted" || t.state === "emergency_stopped")) {
    out.push({ severity: "err", title: t.state === "faulted" ? "Faulted" : "Emergency stopped", detail: "Reset fault to return to disabled." });
  }
  if (t && input.engineConnected) {
    const m = t.mcu;
    if (!m.connected) out.push({ severity: "err", title: "MCU link down" });
    if (m.crc_errors > 0) out.push({ severity: "warn", title: "CRC errors on MCU link", detail: `${m.crc_errors} frame(s)` });
    if (m.last_heartbeat_ms_ago !== null && m.last_heartbeat_ms_ago > 500)
      out.push({ severity: "warn", title: "MCU heartbeat late", detail: `${m.last_heartbeat_ms_ago} ms ago` });
    if (m.queue_capacity > 0 && t.state === "running" && m.queue_depth === 0)
      out.push({ severity: "warn", title: "Motion queue empty while running" });
  }
  for (const p of input.plugins ?? []) {
    if (p.state === "failed") out.push({ severity: "warn", title: `Plugin failed: ${p.id}`, detail: p.error ?? undefined });
  }
  if (input.info?.engine?.fault_injection_enabled) out.push({ severity: "info", title: "Fault injection is enabled on the engine" });
  return out;
}
