import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useOperations } from "./operations";
import { preview, describeError } from "./backendClient";
import type { Decision, Report, ImportSummary } from "./backendTypes";

export interface RoutingPick {
  physician_id: string;
  name: string;
  consults_this_shift: number;
  low_volume_priority: boolean;
  last_answered_at: string | null;
  presence_verified: boolean;
}
export interface RoutingEvidence {
  physician_id: string;
  name: string;
  eligible: boolean;
  reasons: string[];
  consults_this_shift: number;
  last_answered_at: string | null;
  low_volume_threshold: number;
  presence_verified: boolean;
  flags: string[];
}
export interface ReplayFrame {
  index: number;
  as_of: string;
  report: Report;
  decision: Decision & { preview_only: true };
  routing: Record<
    string,
    {
      hospital_name: string;
      selected: RoutingPick | null;
      order: RoutingPick[];
      evidence: RoutingEvidence[];
    }
  >;
  events: {
    event_id: string;
    event_time: string;
    ingested_at: string;
    event_type: string;
    physician_id: string;
    consult_id: string;
    hospital_id: string;
    description: string;
  }[];
}
export interface ReplaySession {
  replay_id: string;
  run_id: string;
  revision: number;
  filename: string;
  import_id: string;
  input_sha256: string | null;
  summary: ImportSummary;
  default_hospital_id: string;
  timeline: string[];
  baseline: ReplayFrame;
}
interface ReplayContext {
  report: Report | null;
  session: ReplaySession | null;
  frame: ReplayFrame | null;
  previous: ReplayFrame | null;
  active: boolean;
  loading: boolean;
  playing: boolean;
  stale: boolean;
  error: string;
  play: () => void;
  pause: () => void;
  next: () => void;
  restart: () => void;
  exit: () => void;
}
const Context = createContext<ReplayContext | null>(null);
export function useRecordedReplay() {
  const value = useContext(Context);
  if (!value) throw new Error("RecordedReplayProvider is required");
  return value;
}
export function RecordedReplayProvider({ children }: { children: ReactNode }) {
  const { report: liveReport, refresh } = useOperations();
  const location = useLocation();
  const [session, setSession] = useState<ReplaySession | null>(null);
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const [previous, setPrevious] = useState<ReplayFrame | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setPlaying(false);
    setLoading(false);
  }, []);
  const exit = useCallback(() => {
    stop();
    setSession(null);
    setFrame(null);
    setPrevious(null);
    setStale(false);
    setError("");
    void refresh().catch(() => {});
  }, [refresh, stop]);
  useEffect(() => {
    if (location.pathname !== "/app") {
      stop();
      setSession(null);
      setFrame(null);
      setPrevious(null);
      setStale(false);
      setError("");
    }
  }, [location.pathname, stop]);
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (
      session &&
      liveReport &&
      (session.run_id !== liveReport.run.run_id ||
        session.revision !== liveReport.run.revision ||
        session.import_id !== liveReport.imports.at(-1)?.import_id)
    ) {
      stop();
      setStale(true);
      setError(
        "The current run changed. Return to current state and load the latest import.",
      );
    }
  }, [session, liveReport, stop]);
  const loadFrame = useCallback(
    async (index: number) => {
      if (!session || loading || stale) return;
      const token = ++generation.current;
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      setError("");
      try {
        const result = await preview<{ data: ReplayFrame }>(
          `/api/v1/replays/${session.replay_id}/frames`,
          { index },
          AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        );
        if (generation.current !== token) return;
        setPrevious(frame);
        setFrame(result.data);
        if (index === session.timeline.length - 1) setPlaying(false);
      } catch (e) {
        if (generation.current === token) {
          setError(describeError(e));
          setPlaying(false);
        }
      } finally {
        if (generation.current === token) {
          request.current = null;
          setLoading(false);
        }
      }
    },
    [session, loading, stale, frame],
  );
  useEffect(() => {
    if (!playing || loading || !session || !frame || stale) return;
    const timer = window.setTimeout(
      () => void loadFrame(frame.index + 1),
      1000,
    );
    return () => clearTimeout(timer);
  }, [playing, loading, session, frame, stale, loadFrame]);
  async function play() {
    if (loading || stale) return;
    if (session && frame) {
      if (frame.index === session.timeline.length - 1) {
        setFrame(session.baseline);
        setPrevious(null);
      }
      setPlaying(true);
      return;
    }
    const token = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await preview<{ data: ReplaySession }>(
        "/api/v1/replays/latest",
        {},
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (generation.current !== token) return;
      setSession(result.data);
      setFrame(result.data.baseline);
      setPrevious(null);
      setPlaying(true);
    } catch (e) {
      if (generation.current === token) setError(describeError(e));
    } finally {
      if (generation.current === token) {
        request.current = null;
        setLoading(false);
      }
    }
  }
  return (
    <Context.Provider
      value={{
        report: frame?.report ?? liveReport,
        session,
        frame,
        previous,
        active: !!session || loading,
        loading,
        playing,
        stale,
        error,
        play: () => void play(),
        pause: stop,
        next: () => {
          setPlaying(false);
          if (frame && session && frame.index < session.timeline.length - 1)
            void loadFrame(frame.index + 1);
        },
        restart: () => {
          stop();
          if (session) {
            setFrame(session.baseline);
            setPrevious(null);
            setError("");
          }
        },
        exit,
      }}
    >
      {children}
    </Context.Provider>
  );
}
