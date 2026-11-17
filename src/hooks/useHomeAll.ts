import { useSyncExternalStore } from "react";
import { api, ApiError } from "../api";
import { HomeAllRunner, type HomeAllState } from "./homeAll";
import { live } from "./liveStore";
import { connectionStatus, isOnline } from "./status";

/** The app-wide "Home all" sequence (outlives screen changes). */
export const homeAll = new HomeAllRunner({
  home: (axis) =>
    api.command("home", { axis }).then(
      () => null,
      (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : String(e)),
    ),
  stop: () => api.command("stop", {}).catch(() => undefined),
  homeAll: () =>
    api.command("home_all", {}).then(
      () => null,
      (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : String(e)),
    ),
  telemetry: () => {
    const s = live.getState();
    return { t: s.telemetry, online: isOnline(connectionStatus(s)) && s.telemetry !== null };
  },
  nextChange: (ms) =>
    new Promise<void>((resolve) => {
      const done = () => {
        unsubscribe();
        window.clearTimeout(timer);
        resolve();
      };
      const unsubscribe = live.subscribe(done);
      const timer = window.setTimeout(done, ms);
    }),
  now: () => performance.now(),
});

export function useHomeAll(): HomeAllState {
  return useSyncExternalStore(homeAll.subscribe, homeAll.getState);
}
