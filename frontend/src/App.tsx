import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import Landing from "./pages/Landing";
import Desk from "./pages/Desk";
import Lab from "./pages/Lab";
import { useDemo } from "./demo/store";
import { clock } from "./lib/format";
import {
  IconFlask,
  IconGrid,
  IconMap,
  IconPlus,
  IconSearch,
} from "./components/Icons";

function Shell({ children }: { children: React.ReactNode }) {
  const { dashboard, openDecide } = useDemo();
  const navigate = useNavigate();
  const label =
    (dashboard as { label?: string }).label ??
    dashboard.dataset_id ??
    "Synthetic demo";

  return (
    <div className="rd-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="rd-top">
        <div className="logo-pixel">
          sevaro<em>.</em>
        </div>
        <label className="rd-search">
          <IconSearch />
          <input
            placeholder="Search hospitals, physicians, consults, interventions"
            aria-label="Search operations"
          />
        </label>
        <div className="rd-top-actions">
          <div style={{ textAlign: "right", fontSize: 12, color: "var(--ink-muted)" }}>
            <div className="tabular">Now {clock(dashboard.as_of)} ET</div>
            <div>{label}</div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              navigate("/app");
              openDecide();
            }}
          >
            <IconPlus />
            Review intervention
          </button>
        </div>
      </header>

      <div className="rd-body">
        <nav className="rd-rail" aria-label="Primary">
          <NavLink to="/app" end title="Command desk">
            <IconGrid />
          </NavLink>
          <NavLink to="/app" end title="Coverage map">
            <IconMap />
          </NavLink>
          <NavLink to="/app/lab" title="Simulation lab">
            <IconFlask />
          </NavLink>
          <NavLink to="/" title="Story landing" style={{ marginTop: "auto" }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>SC</span>
          </NavLink>
        </nav>
        <div id="main" style={{ display: "contents" }}>
          {children}
        </div>
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
          <Shell>
            <Desk />
          </Shell>
        }
      />
      <Route
        path="/app/lab"
        element={
          <Shell>
            <Lab />
          </Shell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}