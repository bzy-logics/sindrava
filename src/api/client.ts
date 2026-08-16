// Typed REST client for ratavyr (docs/rest-api.md, v1).

import type {
  BuildRequest,
  CommandName,
  CommandParams,
  ErrorCode,
  FirmwareJob,
  FirmwareTarget,
  FlashRequest,
  Health,
  Plugin,
  RobotConfig,
  ServerInfo,
  Telemetry,
} from "../types/api";
import { auth } from "./auth";

export class ApiError extends Error {
  readonly code: ErrorCode | (string & {});
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Turn a non-2xx response (status + raw body text) into an ApiError. Uses the
 * `{"error":{"code","message"}}` envelope when present, otherwise falls back
 * to `http_<status>` / the status text.
 */
export function parseError(status: number, statusText: string, text: string): ApiError {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error: unknown }).error;
      if (err && typeof err === "object") {
        const c = (err as { code?: unknown }).code;
        const m = (err as { message?: unknown }).message;
        if (typeof c === "string" && c) code = c;
        if (typeof m === "string" && m) message = m;
      }
    }
  } catch {
    /* not JSON */
  }
  if (!code && status === 401) code = "unauthorized";
  return new ApiError(code ?? `http_${status}`, message ?? (statusText || `HTTP ${status}`), status);
}

export interface ClientOptions {
  base?: string;
  fetch?: typeof fetch;
  getToken?: () => string;
  onUnauthorized?: () => void;
}

export function createClient(opts: ClientOptions = {}) {
  const base = opts.base ?? "/api";
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const getToken = opts.getToken ?? (() => "");
  const onUnauthorized = opts.onUnauthorized ?? (() => {});

  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await doFetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError("network_error", `API unreachable: ${e instanceof Error ? e.message : String(e)}`, 0);
    }

    const text = await res.text();
    if (!res.ok) {
      const err = parseError(res.status, res.statusText, text);
      if (res.status === 401) onUnauthorized();
      throw err;
    }
    if (text.length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError("bad_response", "server returned invalid JSON", res.status);
    }
  }

  const get = <T>(path: string) => request<T>("GET", path);
  const post = <T>(path: string, body: unknown) => request<T>("POST", path, body);

  return {
    health: () => get<Health>("/health"),
    info: () => get<ServerInfo>("/info"),
    status: () => get<Telemetry>("/status"),
    config: () => get<RobotConfig>("/config"),
    plugins: () => get<Plugin[]>("/plugins"),
    command: <C extends CommandName>(name: C, params: CommandParams[C]) =>
      post<Record<string, never>>(`/commands/${encodeURIComponent(name)}`, params),
    firmware: {
      targets: () => get<FirmwareTarget[]>("/firmware/targets"),
      /** Newest first. */
      jobs: () => get<FirmwareJob[]>("/firmware/jobs"),
      job: (id: string) => get<FirmwareJob>(`/firmware/jobs/${encodeURIComponent(id)}`),
      build: (req: BuildRequest) => post<FirmwareJob>("/firmware/builds", req),
      flash: (buildJobId: string) => post<FirmwareJob>("/firmware/flashes", { build_job_id: buildJobId, confirm: true } satisfies FlashRequest),
    },
  };
}

export type ApiClient = ReturnType<typeof createClient>;

/** Default client: same-origin `/api`, token from the auth store. */
export const api: ApiClient = createClient({
  getToken: () => auth.token(),
  onUnauthorized: () => auth.markRejected(),
});
