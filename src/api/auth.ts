// API token handling. The token is optional (only needed when the server runs
// with MOTIONCORE_API_TOKEN); it is kept in localStorage, sent as
// `Authorization: Bearer <token>` on REST and as `?access_token=` on the WS URL.

const STORAGE_KEY = "motioncore.api_token";

export interface AuthState {
  token: string;
  /** Set when a request was rejected with 401 since the token last changed. */
  rejected: boolean;
}

type Listener = () => void;

function load(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

class AuthStore {
  private state: AuthState = { token: typeof window === "undefined" ? "" : load(), rejected: false };
  private listeners = new Set<Listener>();

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

  setToken(token: string) {
    const t = token.trim();
    try {
      if (t) window.localStorage.setItem(STORAGE_KEY, t);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: keep in memory only */
    }
    this.emit({ token: t, rejected: false });
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
