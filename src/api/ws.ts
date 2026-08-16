// WebSocket client for GET /api/ws: parses server messages and reconnects
// with exponential backoff + jitter.

import type { WsMessage } from "../types/api";
import { Backoff } from "./backoff";

export type WsLink = "connecting" | "open" | "closed";

/** Build the WS URL for a page location; the token goes in `access_token`. */
export function buildWsUrl(loc: { protocol: string; host: string }, token: string, base = "/api"): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  return `${proto}//${loc.host}${base}/ws${q}`;
}

/** Parse one text frame; returns null for anything that is not a known message. */
export function parseWsMessage(data: unknown): WsMessage | null {
  if (typeof data !== "string") return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const { type, data: payload } = msg as { type?: unknown; data?: unknown };
  if ((type === "engine" || type === "telemetry" || type === "log") && payload && typeof payload === "object") {
    return msg as WsMessage;
  }
  return null;
}

export interface WsHandlers {
  onMessage: (msg: WsMessage) => void;
  onLink: (link: WsLink, reconnectInMs: number | null) => void;
  /** Called when an established connection drops (not on intentional close). */
  onDrop?: (code: number) => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private readonly backoff = new Backoff(500, 10_000);

  constructor(
    private readonly url: () => string,
    private readonly h: WsHandlers,
  ) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.connect();
  }

  stop() {
    this.active = false;
    this.clearTimer();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  /** Drop the current socket (if any) and connect immediately. */
  reconnectNow() {
    if (!this.active) return;
    this.backoff.reset();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.connect();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private connect() {
    this.clearTimer();
    this.h.onLink("connecting", null);
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoff.reset();
      this.h.onLink("open", null);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      const msg = parseWsMessage(ev.data);
      if (msg) this.h.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return; // intentional close / superseded
      this.ws = null;
      this.h.onDrop?.(ev.code);
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect() {
    if (!this.active) return;
    const delay = this.backoff.next();
    this.h.onLink("closed", delay);
    this.timer = setTimeout(() => this.connect(), delay);
  }
}
