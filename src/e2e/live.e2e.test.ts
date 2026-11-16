// End-to-end check of the whole chain with sindrava's own API/WebSocket
// clients:
//
//   sindrava client -> ratavyr (REST/WS) -> motioncore engine (gRPC) -> virtual MCU
//
// Skipped unless MOTIONCORE_E2E_URL points at a running ratavyr whose engine
// runs robot-profiles/single-axis-virtual.toml. Tokens (if the server uses
// them): MOTIONCORE_E2E_OPERATOR_TOKEN, MOTIONCORE_E2E_VIEWER_TOKEN.
//
//   MOTIONCORE_E2E_URL=http://127.0.0.1:8080 npm test -- src/e2e

import { afterAll, describe, expect, it } from "vitest";
import { ApiError, createClient } from "../api/client";
import { WsClient, resolveWsCredential, wsUrl } from "../api/ws";
import type { RobotState, Telemetry, WsMessage } from "../types/api";

// Node globals without pulling @types/node into a browser project.
declare const process: { env: Record<string, string | undefined> };

const URL_ = process.env.MOTIONCORE_E2E_URL ?? "";
const OPERATOR = process.env.MOTIONCORE_E2E_OPERATOR_TOKEN ?? "";
const VIEWER = process.env.MOTIONCORE_E2E_VIEWER_TOKEN ?? "";

const client = (token: string) => createClient({ base: `${URL_}/api`, getToken: () => token });

describe.skipIf(!URL_)("live stack", () => {
  const op = client(OPERATOR);
  let latest: Telemetry | null = null;
  // Built lazily: the describe body also runs (to collect tests) when skipped.
  const ws = new WsClient(async () => wsUrl(new URL(URL_), await resolveWsCredential(VIEWER || OPERATOR, op.wsTicket)), {
    onMessage: (m: WsMessage) => {
      if (m.type === "telemetry") latest = m.data;
    },
    onLink: () => {},
  });

  afterAll(() => ws.stop());

  async function until(what: string, ok: (t: Telemetry) => boolean, ms = 20_000): Promise<Telemetry> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (latest && ok(latest)) return latest;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for ${what}; last state ${latest?.state}`);
  }
  const state = (s: RobotState) => (t: Telemetry) => t.state === s;

  it("streams telemetry over a ticket-authenticated WebSocket", async () => {
    ws.start();
    const t = await until("telemetry", () => true);
    expect(t.axes.map((a) => a.id)).toContain("j1");
  }, 30_000);

  it("enforces roles", async () => {
    if (!VIEWER) return;
    const viewer = client(VIEWER);
    expect((await viewer.session()).role).toBe("viewer");
    await expect(viewer.command("enable", {})).rejects.toMatchObject({ code: "forbidden" });
  });

  it("runs enable, home, jog, emergency stop and reset", async () => {
    // Start from a known state.
    if (latest?.state === "faulted" || latest?.state === "emergency_stopped") await op.command("reset_fault", {});
    if (latest?.state === "ready") await op.command("disable", {});
    await until("disabled", state("disabled"));

    await op.command("enable", {});
    await until("ready", state("ready"));

    await op.command("home", { axis: "j1" });
    await until("homed", (t) => t.state === "ready" && t.axes[0]!.homed, 40_000);

    const before = latest!.axes[0]!.measured_position;
    await op.command("jog", { axis: "j1", delta: 5 });
    await until("jog done", (t) => t.state === "ready" && Math.abs(t.axes[0]!.measured_position - (before + 5)) < 0.05);

    // An accepted E-stop is not yet a confirmed one: wait for telemetry.
    await op.command("estop", {});
    await until("emergency_stopped", state("emergency_stopped"), 2_000);
    await expect(op.command("enable", {})).rejects.toBeInstanceOf(ApiError);

    await op.command("reset_fault", {});
    const after = await until("disabled after reset", state("disabled"));
    expect(after.axes[0]!.homed).toBe(false);
  }, 90_000);
});
