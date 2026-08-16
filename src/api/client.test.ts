import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient, parseError } from "./client";
import { Backoff } from "./backoff";
import { buildWsUrl, parseWsMessage } from "./ws";

describe("parseError", () => {
  it("uses the error envelope", () => {
    const e = parseError(409, "Conflict", '{"error":{"code":"invalid_state","message":"robot is not ready"}}');
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("invalid_state");
    expect(e.message).toBe("robot is not ready");
    expect(e.status).toBe(409);
  });

  it("falls back to http_<status> for non-JSON bodies", () => {
    const e = parseError(502, "Bad Gateway", "<html>proxy error</html>");
    expect(e.code).toBe("http_502");
    expect(e.message).toBe("Bad Gateway");
  });

  it("maps a bare 401 to unauthorized", () => {
    expect(parseError(401, "", "").code).toBe("unauthorized");
  });

  it("ignores malformed envelopes", () => {
    const e = parseError(500, "", '{"error":"boom"}');
    expect(e.code).toBe("http_500");
    expect(e.message).toBe("HTTP 500");
  });
});

function fakeFetch(status: number, body: string) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(body, { status }));
}

describe("createClient", () => {
  it("sends the bearer token and JSON body", async () => {
    const f = fakeFetch(200, "{}");
    const c = createClient({ fetch: f, getToken: () => "s3cret" });
    await c.command("jog", { axis: "j1", delta: 5 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/commands/jog");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"axis":"j1","delta":5}');
    const h = init?.headers as Record<string, string>;
    expect(h["Authorization"]).toBe("Bearer s3cret");
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("omits Authorization without a token", async () => {
    const f = fakeFetch(200, '{"status":"ok","engine":{"connected":true}}');
    const c = createClient({ fetch: f });
    const h = await c.health();
    expect(h.engine.connected).toBe(true);
    expect((f.mock.calls[0]![1]?.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("flash always sends confirm:true", async () => {
    const f = fakeFetch(202, '{"id":"flash-1"}');
    const c = createClient({ fetch: f });
    await c.firmware.flash("build-3");
    expect(f.mock.calls[0]![0]).toBe("/api/firmware/flashes");
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toEqual({ build_job_id: "build-3", confirm: true });
  });

  it("calls onUnauthorized and throws on 401", async () => {
    const onUnauthorized = vi.fn();
    const c = createClient({ fetch: fakeFetch(401, '{"error":{"code":"unauthorized","message":"missing token"}}'), onUnauthorized });
    await expect(c.config()).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("maps fetch failures to network_error", async () => {
    const c = createClient({
      fetch: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    await expect(c.status()).rejects.toMatchObject({ code: "network_error", status: 0 });
  });
});

describe("Backoff", () => {
  it("doubles up to max and resets", () => {
    const b = new Backoff(500, 4000, 2, 0.2, () => 0.5); // 0.5 → no jitter
    expect([b.next(), b.next(), b.next(), b.next(), b.next()]).toEqual([500, 1000, 2000, 4000, 4000]);
    b.reset();
    expect(b.next()).toBe(500);
  });

  it("applies ±jitter", () => {
    expect(new Backoff(1000, 10_000, 2, 0.2, () => 0).next()).toBeCloseTo(800);
    expect(new Backoff(1000, 10_000, 2, 0.2, () => 0.999999).next()).toBeCloseTo(1200, 0);
  });
});

describe("ws helpers", () => {
  it("builds ws/wss URLs with an encoded access_token", () => {
    expect(buildWsUrl({ protocol: "http:", host: "localhost:5173" }, "")).toBe("ws://localhost:5173/api/ws");
    expect(buildWsUrl({ protocol: "https:", host: "robot.local" }, "a b&c")).toBe("wss://robot.local/api/ws?access_token=a%20b%26c");
  });

  it("parses known messages and rejects junk", () => {
    expect(parseWsMessage('{"type":"engine","data":{"connected":true}}')).toEqual({ type: "engine", data: { connected: true } });
    expect(parseWsMessage('{"type":"bogus","data":{}}')).toBeNull();
    expect(parseWsMessage("not json")).toBeNull();
    expect(parseWsMessage(new ArrayBuffer(2))).toBeNull();
  });
});
