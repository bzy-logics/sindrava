// Live connection to ratavyr: WebSocket telemetry/log stream (via
// WsClient, auto-reconnect), health polling, and REST fetches for
// info/config/plugins. Exposed as an external store for useSyncExternalStore.
// The engine is the state authority; nothing here synthesises robot state
// beyond marking telemetry "disconnected" when the engine link is down.

import { api, auth, buildWsUrl, WsClient, type WsLink } from "../api";
import type { LogEntry, Plugin, RobotConfig, ServerInfo, Telemetry, WsMessage } from "../types/api";

export interface LiveState {
  /** WebSocket link to the API server. */
  link: WsLink;
  /** Seconds until the next reconnect attempt (null when not waiting). */
  reconnectIn: number | null;
  /** Last known API reachability (health/ws). */
  apiReachable: boolean;
  /** Engine connectivity as reported by the API. */
  engineConnected: boolean;
  info: ServerInfo | null;
  telemetry: Telemetry | null;
  config: RobotConfig | null;
  plugins: Plugin[] | null;
  logs: LogEntry[];
}

export interface Sample {
  t: number; // client time, ms (performance.now)
  measured: number;
  commanded: number;
}

const MAX_LOGS = 500;
export const HISTORY_WINDOW_MS = 30_000;
const HEALTH_INTERVAL_MS = 5000;

class LiveStore {
  private state: LiveState = {
    link: "connecting",
    reconnectIn: null,
    apiReachable: true,
    engineConnected: false,
    info: null,
    telemetry: null,
    config: null,
    plugins: null,
    logs: [],
  };
  private listeners = new Set<() => void>();
  private healthTimer: number | null = null;
  private unsubAuth: (() => void) | null = null;
  private lastToken = auth.token();
  private started = 0;
  private readonly ws = new WsClient(() => buildWsUrl(window.location, auth.token()), {
    onMessage: (m) => this.handle(m),
    onLink: (link, ms) => {
      const patch: Partial<LiveState> = { link, reconnectIn: ms === null ? null : Math.max(1, Math.round(ms / 1000)) };
      if (link === "open") {
        patch.apiReachable = true;
        this.set(patch);
        this.refreshStatic();
        void this.checkHealth();
        return;
      }
      this.set(patch);
    },
    onDrop: () => {
      this.markEngineDown();
      void this.checkHealth();
    },
  });

  /** Per-axis position history (last 30 s), kept outside React state. */
  readonly history = new Map<string, Sample[]>();

  getState = (): LiveState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  start() {
    if (this.started++ > 0) return;
    this.ws.start();
    void this.refreshInfo();
    this.refreshStatic();
    this.healthTimer = window.setInterval(() => void this.checkHealth(), HEALTH_INTERVAL_MS);
    // A new token: reconnect the socket (token is in its URL) and re-fetch.
    this.unsubAuth = auth.subscribe(() => {
      const t = auth.token();
      if (t === this.lastToken) return;
      this.lastToken = t;
      this.ws.reconnectNow();
      void this.refreshInfo();
      this.refreshStatic();
    });
  }

  stop() {
    if (--this.started > 0) return;
    if (this.healthTimer !== null) window.clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.unsubAuth?.();
    this.unsubAuth = null;
    this.ws.stop();
  }

  async refreshInfo() {
    try {
      this.set({ info: await api.info() });
    } catch {
      /* older server or unreachable; keep previous */
    }
  }

  /** Re-fetch config and plugin list (cheap; done on (re)connect). */
  refreshStatic() {
    api.config().then(
      (config) => this.set({ config }),
      () => {},
    );
    api.plugins().then(
      (plugins) => this.set({ plugins }),
      () => {},
    );
    if (!this.state.telemetry) {
      api.status().then(
        (telemetry) => {
          if (!this.state.telemetry) this.set({ telemetry, engineConnected: true });
        },
        () => {},
      );
    }
  }

  private async checkHealth() {
    try {
      const h = await api.health();
      const connected = h.engine.connected;
      const becameConnected = connected && !this.state.engineConnected;
      this.set({ apiReachable: true, engineConnected: connected });
      if (becameConnected) {
        this.refreshStatic();
        void this.refreshInfo();
      }
      if (!connected) this.markEngineDown();
    } catch {
      this.set({ apiReachable: false, engineConnected: false });
      this.markEngineDown();
    }
  }

  private markEngineDown() {
    const t = this.state.telemetry;
    if (t && t.state !== "disconnected") this.set({ telemetry: { ...t, state: "disconnected" } });
  }

  /** Reconnect now (user clicked "Retry"). */
  retry() {
    this.ws.reconnectNow();
    void this.refreshInfo();
  }

  private handle(msg: WsMessage) {
    switch (msg.type) {
      case "telemetry": {
        this.record(msg.data);
        const patch: Partial<LiveState> = { telemetry: msg.data };
        if (!this.state.engineConnected) {
          patch.engineConnected = true;
          this.refreshStatic();
        }
        this.set(patch);
        break;
      }
      case "log": {
        const logs = this.state.logs.length >= MAX_LOGS ? this.state.logs.slice(-(MAX_LOGS - 1)) : this.state.logs.slice();
        logs.push(msg.data);
        this.set({ logs });
        break;
      }
      case "engine": {
        const was = this.state.engineConnected;
        this.set({ engineConnected: msg.data.connected });
        if (!msg.data.connected) this.markEngineDown();
        else if (!was) {
          this.refreshStatic();
          void this.refreshInfo();
        }
        break;
      }
    }
  }

  private record(t: Telemetry) {
    const now = performance.now();
    for (const a of t.axes) {
      let buf = this.history.get(a.id);
      if (!buf) this.history.set(a.id, (buf = []));
      buf.push({ t: now, measured: a.measured_position, commanded: a.commanded_position });
      let drop = 0;
      while (drop < buf.length && now - buf[drop]!.t > HISTORY_WINDOW_MS) drop++;
      if (drop > 0) buf.splice(0, drop);
    }
  }

  clearLogs() {
    this.set({ logs: [] });
  }
}

export const live = new LiveStore();
