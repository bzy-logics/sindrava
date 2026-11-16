// WebSocket client for GET /api/ws: parses server messages and reconnects
// with exponential backoff + jitter.

import type { WsMessage, WsTicket } from "../types/api";
import { ApiError } from "./client";
import { Backoff } from "./backoff";

export type WsLink = "connecting" | "open" | "closed";

/** How the WebSocket authenticates: a single-use ticket (preferred) or the legacy query token. */
export type WsCredential = { ticket: string } | { token: string } | null;

/** Build the WS URL for a page location and credential. */
export function wsUrl(loc: { protocol: string; host: string }, cred: WsCredential, base = "/api"): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  let q = "";
  if (cred && "ticket" in cred) q = `?ticket=${encodeURIComponent(cred.ticket)}`;
  else if (cred && cred.token) q = `?access_token=${encodeURIComponent(cred.token)}`;
  return `${proto}//${loc.host}${base}/ws${q}`;
}

/** Legacy form: the token goes in `access_token` (servers < 0.3 only). */
export function buildWsUrl(loc: { protocol: string; host: string }, token: string, base = "/api"): string {
  return wsUrl(loc, token ? { token } : null, base);
}

/**
 * Pick the WebSocket credential for a token. With a token, a fresh
 * single-use ticket is requested so the long-lived token never appears in a
 * URL. Only servers without the ticket endpoint (404/405, ratavyr < 0.3) get
 * the legacy `?access_token=`. Other failures (401, network) are thrown and
 * the caller retries later.
 */
export async function resolveWsCredential(token: string, getTicket: () => Promise<WsTicket>): Promise<WsCredential> {
  if (!token) return null;
  try {
    return { ticket: (await getTicket()).ticket };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return { token };
    throw e;
  }
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

  /** Incremented on every connect/stop so stale async URL lookups are dropped. */
  private gen = 0;

  constructor(
    private readonly url: () => string | Promise<string>,
    private readonly h: WsHandlers,
  ) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.connect();
  }

  stop() {
    this.active = false;
    this.gen++;
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
    const gen = ++this.gen;
    let url: string | Promise<string>;
    try {
      url = this.url();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (typeof url === "string") {
      this.open(url);
      return;
    }
    url.then(
      (u) => {
        if (gen === this.gen && this.active) this.open(u);
      },
      () => {
        if (gen === this.gen) this.scheduleReconnect();
      },
    );
  }

  private open(url: string) {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
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
