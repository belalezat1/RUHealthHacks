import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import Landing from "./pages/Landing";
import Desk from "./pages/Desk";
import Lab from "./pages/Lab";
import { RelayMark } from "./components/RelayMark";
import { IconBolt, IconDesk } from "./components/Icons";
import { useDemo } from "./demo/store";
import { clock, clockDate } from "./lib/format";
import { brand } from "./brand";

function AppShell({ children }: { children: React.ReactNode }) {
  const { dashboard, openDecide } = useDemo();
  const navigate = useNavigate();
  const location = useLocation();
  const isLab = location.pathname.includes("/lab");

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="app-aside">
        <div className="app-aside-top">
          <RelayMark size="nav" href="/" />
          <div className="app-workspace">
            <strong>Harbor network</strong>
            <span>Live ops · synthetic demo</span>
          </div>
        </div>
        <nav className="app-nav" aria-label="Primary">
          <NavLink to="/app" end>
            <IconDesk size={17} />
            {brand.deskLabel}
          </NavLink>
          <NavLink to="/app/lab">
            <IconBolt size={17} />
            {brand.labLabel}
          </NavLink>
        </nav>
        <div className="app-aside-foot">
          <div className="aside-now">
            <span className="aside-now-label">Now</span>
            <span className="aside-now-time tabular">{clock(dashboard.as_of)} ET</span>
          </div>
          <div className="aside-date tabular">{clockDate(dashboard.as_of)}</div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-title">
            <h1>{isLab ? brand.labLabel : brand.deskLabel}</h1>
            <p className="app-topbar-sub">
              {isLab
                ? "Inject edge cases · audit trail · safety constraints"
                : "Stroke-priority coverage · Synapse · human approval"}
            </p>
          </div>
          <div className="app-topbar-actions">
            {!isLab ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  navigate("/app");
                  openDecide();
                }}
              >
                Review intervention
              </button>
            ) : null}
          </div>
        </header>
        <main id="main" className="page-enter route-fade" key={location.pathname}>
          {children}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/app"
        element={
          <AppShell>
            <Desk />
          </AppShell>
        }
      />
      <Route
        path="/app/lab"
        element={
          <AppShell>
            <Lab />
          </AppShell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
