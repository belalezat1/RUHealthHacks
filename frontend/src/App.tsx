import { lazy, Suspense } from "react";
import { NavLink, Route, Routes, Link } from "react-router-dom";
import { isNoDataset } from "./api/client";
import { useDashboard } from "./api/hooks";
import { Badge, Icon, Loading, datetime } from "./components/ui";
import CommandCenter from "./pages/CommandCenter";
const CoverageForecast = lazy(() => import("./pages/CoverageForecast"));
const Physicians = lazy(() => import("./pages/Physicians"));
const Consultations = lazy(() => import("./pages/Consultations"));
const Interventions = lazy(() => import("./pages/Interventions"));
const SimulationLab = lazy(() => import("./pages/SimulationLab"));
const nav = [
  ["/", "overview", "Command Center"],
  ["/coverage", "chart", "Coverage Forecast"],
  ["/physicians", "people", "Physician Intelligence"],
  ["/consultations", "queue", "Consultation Queue"],
  ["/interventions", "spark", "Interventions"],
  ["/simulation", "flask", "Simulation Lab"],
];
export default function App() {
  const snapshot = useDashboard();
  const data = snapshot.data;
  const noDataset = isNoDataset(snapshot.error);
  const disconnected = snapshot.isError && !noDataset;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="Sevaro Command Center">
          <span className="brand-mark">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>
            sevaro<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="workspace-label">
          COMMAND CENTER <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          {nav.map(([to, icon, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                isActive ? "nav-item active" : "nav-item"
              }
            >
              <Icon name={icon} size={19} />
              <span>{label}</span>
              {to === "/interventions" &&
                !!data?.counts.pending_interventions && (
                  <b>{data.counts.pending_interventions}</b>
                )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="network-note">
            <span className="status-dot" />
            <div>
              <strong>Local operations workspace</strong>
              <small>Synthetic network · Demo policy</small>
            </div>
          </div>
          <div className="actor">
            <span className="avatar">OD</span>
            <div>
              <strong>Operations dispatcher</strong>
              <small>Explicit local demo actor</small>
            </div>
            <Icon name="shield" size={18} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Operations <span>/</span> Network workspace
          </div>
          <div className="topbar-right">
            <Badge tone="amber" dot>
              Synthetic demo
            </Badge>
            <span
              className={`connection-state ${disconnected ? "disconnected" : ""}`}
            >
              <i />
              {noDataset
                ? "Ready to import"
                : disconnected
                  ? "Disconnected"
                  : snapshot.isPending
                    ? "Connecting"
                    : "Live · 3s refresh"}
            </span>
            <button
              className="icon-button"
              title="Refresh operational snapshot"
              aria-label="Refresh operational snapshot"
              disabled={snapshot.isFetching}
              onClick={() => void snapshot.refetch()}
            >
              <Icon name="refresh" size={17} />
            </button>
          </div>
        </header>
        <div className="dataset-bar">
          <div>
            <Icon name="database" size={14} />
            <span>Active dataset</span>
            <strong>{data?.dataset_id ?? "Not yet imported"}</strong>
            {data && <span className="version">v{data.source_version}</span>}
          </div>
          <div>
            <span>
              Jev <strong>{data?.jev.mode ?? "—"}</strong>
            </span>
            <span className="divider" />
            <span>
              Last successful refresh{" "}
              <strong>
                {snapshot.dataUpdatedAt
                  ? datetime(new Date(snapshot.dataUpdatedAt).toISOString())
                  : "—"}
              </strong>
            </span>
          </div>
        </div>
        {disconnected && (
          <div className="global-notice" role="alert">
            <Icon name="alert" size={16} />
            <strong>Live updates disconnected.</strong>{" "}
            {data
              ? "Showing the last successful snapshot. Actions may be rejected until the API reconnects."
              : "Start the backend to connect this workspace."}
            <button onClick={() => void snapshot.refetch()}>
              Retry connection
            </button>
          </div>
        )}
        {data && (!!data.freshness.stale || !!data.freshness.conflicts) && (
          <div className="global-notice warning" role="status">
            <Icon name="alert" size={16} />
            <strong>Evidence needs attention.</strong>{" "}
            {humanCount(data.freshness.stale, "stale signal")}
            {data.freshness.stale && data.freshness.conflicts ? " · " : ""}
            {humanCount(data.freshness.conflicts, "conflict")}
            <Link to="/physicians">Inspect physician evidence →</Link>
          </div>
        )}
        <main id="main">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<CommandCenter />} />
              <Route path="/coverage" element={<CoverageForecast />} />
              <Route path="/physicians" element={<Physicians />} />
              <Route path="/consultations" element={<Consultations />} />
              <Route path="/interventions" element={<Interventions />} />
              <Route path="/simulation" element={<SimulationLab />} />
              <Route
                path="*"
                element={
                  <div className="empty">
                    <h1>Page not found</h1>
                    <Link className="button primary" to="/">
                      Return to Command Center
                    </Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>SEVARO COMMAND CENTER</span>
          <span>
            Synthetic operations demonstration · All times shown in your local
            timezone
          </span>
        </footer>
      </div>
    </div>
  );
}
function humanCount(value: number | boolean, label: string) {
  return value
    ? `${typeof value === "number" ? `${value} ` : ""}${label}${typeof value === "number" && value !== 1 ? "s" : ""}`
    : "";
}
