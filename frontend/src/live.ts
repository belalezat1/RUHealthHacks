import { useCallback, useEffect, useRef, useState } from "react";
import { get, rememberState } from "./api";
import type { LiveState } from "./types";

const POLL_MS = 2000;
const STALE_AFTER_MS = 6000;

export interface Live<T> {
  data: T | null;
  state: LiveState | null;
  error: string | null;
  stale: boolean;
  loading: boolean;
  lastUpdated: number | null;
  lastFetchMs: number | null;
  refresh: () => Promise<void>;
}

/**
 * Poll the cheap /state endpoint every 2 s; fetch the heavy resource only when the
 * revision changes. Mark the view stale if polling fails for more than 6 s.
 */
export function useLive<T>(path: string): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const seen = useRef<string>("");
  const busy = useRef(false);

  const load = useCallback(
    async (force: boolean) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const s = await get<LiveState>("/api/v1/state");
        rememberState(s);
        setState(s);
        setLastOk(Date.now());
        const key = `${s.run_id}:${s.revision}`;
        if (force || key !== seen.current) {
          const t0 = performance.now();
          const body = await get<{ data: T }>(path);
          setLastFetchMs(Math.round(performance.now() - t0));
          seen.current = key;
          setData(body.data);
          setLastUpdated(Date.now());
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy.current = false;
      }
    },
    [path],
  );

  useEffect(() => {
    load(true);
    const t = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState !== "hidden") load(false);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return {
    data,
    state,
    error,
    stale: lastOk !== null && now - lastOk > STALE_AFTER_MS,
    loading: data === null && !error,
    lastUpdated,
    lastFetchMs,
    refresh: () => load(true),
  };
}
