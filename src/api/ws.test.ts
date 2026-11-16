import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { WsClient, resolveWsCredential, wsUrl } from "./ws";

const loc = { protocol: "https:", host: "robot.local" };

describe("wsUrl", () => {
  it("prefers tickets and never mixes in the token", () => {
    expect(wsUrl(loc, { ticket: "t/1" })).toBe("wss://robot.local/api/ws?ticket=t%2F1");
    expect(wsUrl(loc, { token: "tok" })).toBe("wss://robot.local/api/ws?access_token=tok");
    expect(wsUrl({ protocol: "http:", host: "h:1" }, null)).toBe("ws://h:1/api/ws");
  });
});

describe("resolveWsCredential", () => {
  it("needs nothing without a token", async () => {
    const get = vi.fn();
    expect(await resolveWsCredential("", get)).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
  it("exchanges the token for a ticket", async () => {
    expect(await resolveWsCredential("tok", async () => ({ ticket: "abc", expires_in_ms: 30000 }))).toEqual({ ticket: "abc" });
  });
  it("falls back to the legacy query token only for servers without tickets", async () => {
    for (const status of [404, 405]) {
      const old = async () => {
        throw new ApiError("not_found", "no such endpoint", status);
      };
      expect(await resolveWsCredential("tok", old)).toEqual({ token: "tok" });
    }
  });
  it("does not leak the token into a URL on other errors", async () => {
    const denied = async () => {
      throw new ApiError("unauthorized", "bad token", 401);
    };
    await expect(resolveWsCredential("tok", denied)).rejects.toBeInstanceOf(ApiError);
    const down = async () => {
      throw new ApiError("network_error", "unreachable", 0);
    };
    await expect(resolveWsCredential("tok", down)).rejects.toBeInstanceOf(ApiError);
  });
});

class FakeWs {
  static made: FakeWs[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeWs.made.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe("WsClient with an async URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWs.made = [];
  });

  it("opens once the URL resolves and drops results that arrive after stop()", async () => {
    vi.stubGlobal("WebSocket", FakeWs);
    let resolve!: (u: string) => void;
    const links: string[] = [];
    const c = new WsClient(() => new Promise<string>((r) => (resolve = r)), { onMessage: () => {}, onLink: (l) => links.push(l) });
    c.start();
    expect(FakeWs.made).toHaveLength(0);
    resolve("ws://x/api/ws?ticket=1");
    await Promise.resolve();
    expect(FakeWs.made.map((w) => w.url)).toEqual(["ws://x/api/ws?ticket=1"]);

    // A reconnect whose ticket arrives after stop() must not open a socket.
    c.reconnectNow();
    c.stop();
    resolve("ws://x/api/ws?ticket=2");
    await Promise.resolve();
    expect(FakeWs.made).toHaveLength(1);
    expect(links[0]).toBe("connecting");
  });

  it("retries later when the URL cannot be obtained", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWs);
    const delays: (number | null)[] = [];
    let calls = 0;
    const c = new WsClient(
      async () => {
        calls++;
        throw new Error("ticket failed");
      },
      { onMessage: () => {}, onLink: (l, ms) => l === "closed" && delays.push(ms) },
    );
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(delays).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toBeGreaterThan(1);
    expect(FakeWs.made).toHaveLength(0);
    c.stop();
    vi.useRealTimers();
  });
});
