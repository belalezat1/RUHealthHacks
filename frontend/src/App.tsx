import { useEffect, useState } from "react";
import { ApiError, get, login, logout, setCsrf } from "./api";
import { roleLabel } from "./format";
import type { User } from "./types";
import StaffDesk from "./components/StaffDesk";
import PhysicianView from "./components/PhysicianView";

interface DemoAccounts {
  password: string;
  accounts: { username: string; display_name: string; role: string }[];
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    get<{ user: User; csrf_token: string }>("/api/v1/session")
      .then((s) => {
        setCsrf(s.csrf_token);
        setUser(s.user);
      })
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const signOut = async () => {
    await logout();
    setUser(null);
  };

  if (checking) return <div className="login muted">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;
  if (user.role === "physician") return <PhysicianView user={user} onSignOut={signOut} />;
  return <StaffDesk user={user} onSignOut={signOut} />;
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<DemoAccounts | null>(null);

  useEffect(() => {
    get<DemoAccounts>("/api/v1/demo-accounts").then(setDemo).catch(() => setDemo(null));
  }, []);

  const submit = async (u = username, p = password) => {
    setBusy(true);
    setError(null);
    try {
      const out = await login(u, p);
      onLogin(out.user);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="card">
        <div className="brand" style={{ marginBottom: 4 }}>
          <span className="brand-mark" aria-hidden>S</span> <span className="gradient-text">Intervention Desk</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "6px 0 4px" }}>Detect. Decide. Act.</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Synthetic tele-neurology operations demo. No real physicians are contacted and no patient data is used.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="stack"
          style={{ gap: 10 }}
        >
          <div>
            <label htmlFor="u">Username</label>
            <input id="u" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p">Password</label>
            <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="notice error" role="alert">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy || !username || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {demo && (
          <div style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 8 }}>Local demo accounts</h3>
            <div className="account-grid">
              {demo.accounts.map((a) => (
                <button key={a.username} className="btn small" disabled={busy} onClick={() => submit(a.username, demo.password)}
                  title={`${a.display_name} (${roleLabel(a.role)})`}>
                  {a.role === "physician" ? a.display_name : roleLabel(a.role)}
                </button>
              ))}
            </div>
            <p className="muted small">Shown only in local mode. Hosted mode uses server-configured passwords.</p>
          </div>
        )}
        <p className="footer-note" style={{ paddingBottom: 0 }}>
          Built for Sevaro Challenge 2 at Rutgers Health Hack 2026. Not an official Sevaro product.
        </p>
      </div>
    </div>
  );
}
