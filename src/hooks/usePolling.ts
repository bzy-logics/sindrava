import { useCallback, useEffect, useRef, useState } from "react";

export interface Polled<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Fetch now (also restarts the interval). */
  refresh: () => Promise<void>;
}

/**
 * Fetch `fn` on mount and then every `intervalMs` while `intervalMs` is not
 * null. Overlapping fetches are skipped; results of stale fetches dropped.
 */
export function usePolling<T>(fn: () => Promise<T>, intervalMs: number | null): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const inflight = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (mounted.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      inflight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (intervalMs === null) return;
    const id = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, refresh]);

  return { data, error, loading, refresh };
}
