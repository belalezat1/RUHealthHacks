import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "./backendClient";
import type {
  Envelope,
  LiveState,
  PhysicianOffer,
  Report,
  User,
} from "./backendTypes";

type Operations = {
  user: User;
  report: Report | null;
  offers: PhysicianOffer[];
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  write: <T>(path: string, body?: unknown, csv?: string) => Promise<T>;
  signOut: () => Promise<void>;
};
const Context = createContext<Operations | null>(null);
export function useOperations() {
  const value = useContext(Context);
  if (!value) throw new Error("Operations session is required");
  return value;
}
export function OperationsProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [offers, setOffers] = useState<PhysicianOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const refresh = useCallback(async () => {
    if (!user) return;
    if (user.role === "physician") {
      const state = await api.get<LiveState>("/api/v1/state");
      const result =
        await api.get<Envelope<{ offers: PhysicianOffer[] }>>(
          "/api/v1/me/offers",
        );
      api.rememberState(state);
      setOffers(result.data.offers);
    } else {
      const result = await api.get<Envelope<Report>>("/api/v1/report");
      api.rememberState({
        run_id: result.run_id,
        revision: result.revision,
        as_of: result.as_of,
        label: result.data.run.label,
        release_sha: result.release_sha,
        schema_version: result.schema_version,
      });
      setReport(result.data);
    }
  }, [user]);
  useEffect(() => {
    // Never hydrate operational data from the previous client-only mock store.
    try {
      localStorage.removeItem("relay-demo-state-v1");
    } catch {
      /* Storage may be disabled. */
    }
    api
      .get<{ user: User; csrf_token: string }>("/api/v1/session")
      .then((s) => {
        api.setCsrf(s.csrf_token);
        setUser(s.user);
      })
      .catch((e) => {
        if (!(e instanceof api.ApiError && e.status === 401))
          setError(api.describeError(e));
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () =>
      refresh().catch((e) => {
        if (alive) {
          setError(api.describeError(e));
          if (e instanceof api.ApiError && e.status === 401) {
            setUser(null);
            setReport(null);
            setOffers([]);
          }
        }
      });
    void load();
    const timer = setInterval(() => {
      if (!lock.current) void load();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [user, refresh]);
  async function write<T>(
    path: string,
    body?: unknown,
    csv?: string,
  ): Promise<T> {
    if (lock.current) throw new Error("Another operation is still running.");
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.mutate<T>(path, body, { csv });
      await refresh();
      return result.result;
    } catch (e) {
      setError(api.describeError(e));
      await refresh().catch(() => {});
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function signOut() {
    await api.logout();
    setUser(null);
    setReport(null);
    setOffers([]);
    setError("");
  }
  if (loading)
    return <div className="rx real-login">Connecting to backend…</div>;
  if (!user)
    return (
      <div className="rx real-login">
        <form
          className="rx-card real-login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const session = await api.login(username, password);
              setPassword("");
              setUser(session.user);
            } catch (e) {
              setError(api.describeError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h1>Sign in to Relay</h1>
          <p>Official challenge records · Server-enforced roles</p>
          <label>
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="rx-btn rx-btn-primary" disabled={busy}>
            Sign in
          </button>
        </form>
      </div>
    );
  return (
    <Context.Provider
      value={{ user, report, offers, busy, error, refresh, write, signOut }}
    >
      {children}
    </Context.Provider>
  );
}
