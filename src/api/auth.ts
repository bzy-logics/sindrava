// API token handling. The token is optional (only needed when the server runs
// with tokens configured). It is sent as `Authorization: Bearer <token>` on
// REST; the WebSocket uses a short-lived single-use ticket obtained with it
// (see ws.ts), so the token never appears in a URL on current servers.
//
// Storage: sessionStorage by default (gone when the tab closes); with
// "remember on this device" it is kept in localStorage.

const STORAGE_KEY = "motioncore.api_token";

export interface AuthState {
  token: string;
  /** Token is kept in localStorage (survives closing the browser). */
  remembered: boolean;
  /** Set when a request was rejected with 401 since the token last changed. */
  rejected: boolean;
}

type Listener = () => void;

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function load(): { token: string; remembered: boolean } {
  try {
    const local = storage("local")?.getItem(STORAGE_KEY);
    if (local) return { token: local, remembered: true };
    return { token: storage("session")?.getItem(STORAGE_KEY) ?? "", remembered: false };
  } catch {
    return { token: "", remembered: false };
  }
}

export class AuthStore {
  private state: AuthState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = typeof window === "undefined" ? { token: "", remembered: false, rejected: false } : { ...load(), rejected: false };
  }

  getState = (): AuthState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  token(): string {
    return this.state.token;
  }

  /** Store (or clear, with "") the token; `remember` selects localStorage over sessionStorage. */
  setToken(token: string, remember = this.state.remembered) {
    const t = token.trim();
    try {
      storage("local")?.removeItem(STORAGE_KEY);
      storage("session")?.removeItem(STORAGE_KEY);
      if (t) storage(remember ? "local" : "session")?.setItem(STORAGE_KEY, t);
    } catch {
      /* storage unavailable: keep in memory only */
    }
    this.emit({ token: t, remembered: remember && t !== "", rejected: false });
  }

  /** Called by the REST client whenever the server answers 401. */
  markRejected() {
    if (!this.state.rejected) this.emit({ ...this.state, rejected: true });
  }

  private emit(next: AuthState) {
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}

export const auth = new AuthStore();
