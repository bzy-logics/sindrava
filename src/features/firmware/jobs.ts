import type { FirmwareJob, FirmwareTarget, McuConfig } from "../../types/api";

export const isActive = (j: FirmwareJob) => j.state === "queued" || j.state === "running";

/** Last `n` non-empty lines of a job log. */
export function logTail(log: string, n = 8): string {
  const lines = log.replace(/\s+$/, "").split(/\r?\n/);
  return lines.slice(-n).join("\n");
}

export interface Eligibility {
  ok: boolean;
  reason?: string;
}

/** Whether the UI offers "Build firmware" for an MCU (the server still validates). */
export function buildEligibility(mcu: McuConfig, targets: FirmwareTarget[] | null, jobs: FirmwareJob[] | null): Eligibility {
  const target = targets?.find((t) => t.board === mcu.board);
  if (targets && !target) return { ok: false, reason: `no firmware target for board "${mcu.board}"` };
  if (target?.is_virtual) return { ok: false, reason: "virtual board — no firmware to build" };
  if (jobs?.some((j) => j.mcu === mcu.name && isActive(j))) return { ok: false, reason: "a job for this MCU is in progress" };
  return { ok: true };
}

/** Whether the UI offers "Flash" for a job (only succeeded builds with an artifact). */
export function flashEligibility(job: FirmwareJob, targets: FirmwareTarget[] | null, jobs: FirmwareJob[] | null): Eligibility {
  if (job.kind !== "build" || job.state !== "succeeded" || !job.artifact) return { ok: false };
  if (targets?.find((t) => t.board === job.artifact?.board)?.is_virtual) return { ok: false, reason: "virtual board" };
  if (jobs?.some((j) => j.mcu === job.mcu && isActive(j))) return { ok: false, reason: "a job for this MCU is in progress" };
  return { ok: true };
}
