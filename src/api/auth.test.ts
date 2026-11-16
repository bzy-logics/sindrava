// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { AuthStore } from "./auth";

const KEY = "motioncore.api_token";

describe("AuthStore", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("keeps the token for this tab only by default", () => {
    const a = new AuthStore();
    a.setToken("  secret  ");
    expect(a.token()).toBe("secret");
    expect(sessionStorage.getItem(KEY)).toBe("secret");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(a.getState().remembered).toBe(false);
  });

  it("remembers on this device only when asked, and moves between stores", () => {
    const a = new AuthStore();
    a.setToken("secret", true);
    expect(localStorage.getItem(KEY)).toBe("secret");
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(new AuthStore().getState()).toEqual({ token: "secret", remembered: true, rejected: false });
    a.setToken("other", false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBe("other");
  });

  it("clears everywhere and resets the rejected flag", () => {
    const a = new AuthStore();
    a.setToken("x", true);
    a.markRejected();
    expect(a.getState().rejected).toBe(true);
    a.setToken("");
    expect(a.getState()).toEqual({ token: "", remembered: false, rejected: false });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
