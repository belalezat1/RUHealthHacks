import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { RelayMark } from "../RelayMark";
import { ThemeToggle, useTheme } from "../../theme";
import { OperationsProvider, useOperations } from "../../operations";
import { brand } from "../../brand";
import { Avatar, Pill } from "../ui";
import { IconDesk, IconBolt, IconClock, IconArrowLeft } from "../Icons";
import {
  RecordedReplayProvider,
  useRecordedReplay,
} from "../../recordedReplay";
function ConnectedShell() {
  const { user, error, refresh, signOut, busy } = useOperations();
  const { report, active: replayActive } = useRecordedReplay();
  const { theme } = useTheme();
  const isLab = useLocation().pathname.startsWith("/app/lab");
  useEffect(() => {
    document.title = `${brand.name} — ${isLab ? brand.labLabel : user.role === "physician" ? "Your shift offers" : brand.deskLabel}`;
  }, [isLab, user.role]);
  const scenarioTime = report
    ? new Date(report.as_of).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <div className="rx" data-theme={theme}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="rx-side" aria-label="Workspace sidebar">
        <div className="rx-side-brand">
          <RelayMark size="nav" href="/" />
          <span className="ops-brand-caption">Clinical operations</span>
        </div>
        <nav className="rx-nav" aria-label="Primary">
          <NavLink
            to="/app"
            end
            className={({ isActive }) =>
              `rx-nav-item${isActive ? " is-active" : ""}`
            }
          >
            <IconDesk size={20} />
            <span>{brand.deskLabel}</span>
          </NavLink>
          {user.role !== "physician" && (
            <NavLink
              to="/app/lab"
              className={({ isActive }) =>
                `rx-nav-item${isActive ? " is-active" : ""}`
              }
            >
              <IconBolt size={20} />
              <span>{brand.labLabel}</span>
            </NavLink>
          )}
        </nav>
        {user.role !== "physician" && !isLab && (
          <nav className="ops-section-nav" aria-label="Desk sections">
            <span>IN THIS WORKSPACE</span>
            <a href="#forecast">Coverage forecast</a>
            <a href="#interventions">Staffing & eligibility</a>
            <a href="#offers">Approval & offers</a>
            <a href="#queue">Risk queue</a>
            <a href="#people">Physicians & consults</a>
          </nav>
        )}
        <div className="ops-side-note">
          <span className="ops-status-dot" /> Backend updates
          <p>
            Recorded CSV events
            <br />
            Refreshes every 5 seconds
          </p>
        </div>
        <div className="rx-side-foot">
          <div className="rx-operator">
            <Avatar name={user.display_name} />
            <div>
              <strong>{user.display_name}</strong>
              <span>{user.role.replaceAll("_", " ")}</span>
            </div>
          </div>
          <div className="ops-account-actions">
            <ThemeToggle />
            <button
              className="rx-btn rx-btn-secondary"
              disabled={busy}
              onClick={() => void signOut().catch(() => {})}
            >
              <IconArrowLeft size={16} />
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="rx-main">
        <header className="rx-header">
          <div className="rx-header-title">
            <div className="ops-breadcrumb">
              Workspace <span>/</span>{" "}
              {isLab ? "Scenario lab" : "Coverage desk"}
            </div>
            <h1>
              {isLab
                ? "Scenario lab"
                : user.role === "physician"
                  ? "Your shift offers"
                  : "Coverage desk"}
            </h1>
            <p>
              {isLab
                ? "Import recorded events. See what changes."
                : "See coverage risk, review your options, and act."}
            </p>
          </div>
          <div className="ops-header-actions">
            {scenarioTime && (
              <span className="ops-scenario-time">
                <IconClock size={16} />
                <span>
                  {scenarioTime} ET<small>Scenario time</small>
                </span>
              </span>
            )}
            <Pill tone="accent">
              {replayActive ? "Recorded replay" : "Recorded data"}
            </Pill>
            <button
              className="rx-btn rx-btn-secondary"
              disabled={busy || replayActive}
              onClick={() => void refresh().catch(() => {})}
            >
              Refresh data
            </button>
          </div>
        </header>
        <main id="main">
          {error && (
            <p className="real-error" role="alert">
              {error}
            </p>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
export function AppShell() {
  return (
    <OperationsProvider>
      <RecordedReplayProvider>
        <ConnectedShell />
      </RecordedReplayProvider>
    </OperationsProvider>
  );
}
