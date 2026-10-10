import { useState } from "react";
import { hhmmss, roleLabel } from "../format";
import { useLive } from "../live";
import type { Report, User } from "../types";
import DeskTab from "./DeskTab";
import OffersTab from "./OffersTab";
import StateTab from "./StateTab";
import DataTab from "./DataTab";
import AuditTab from "./AuditTab";
import EvidenceTab from "./EvidenceTab";

const TABS = ["Desk", "Offers", "Network state", "Data & clock", "Actions & audit", "Evidence"] as const;
type Tab = (typeof TABS)[number];

export default function StaffDesk({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const live = useLive<Report>("/api/v1/report");
  const [tab, setTab] = useState<Tab>("Desk");
  const r = live.data;

  const openOffers = r?.offers.filter((o) => ["proposed", "approved", "sent"].includes(o.status)).length ?? 0;
  const openEsc = r?.actions.filter((a) => a.kind === "escalation" && a.status === "open").length ?? 0;
  const counts: Partial<Record<Tab, number>> = {
    Desk: r?.risks.filter((x) => x.severity === "critical").length,
    Offers: openOffers || undefined,
    "Actions & audit": openEsc || undefined,
  };

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden>S</span> Sevaro Intervention Desk</div>
        <div className="chips">
          {live.state && (
            <>
              <span className="chip" title="Scenario clock (manual). Not today's wall clock.">
                Scenario clock <b className="num">{hhmmss(live.state.as_of)} ET</b>
              </span>
              <span className="chip num" title={live.state.run_id}>{live.state.label} · rev {live.state.revision}</span>
              {r && (
                <span className="chip" title={r.verification.label}>
                  {r.verification.passed ? `Snapshot ${r.verification.matched}/${r.verification.compared} ✓`
                    : r.verification.original_run ? "Reference time passed" : "Live data"}
                </span>
              )}
            </>
          )}
          <span className="chip" role="status">
            <span className={`dot ${live.error ? "error" : live.stale ? "stale" : ""}`} aria-hidden />
            {live.error ? "Connection error" : live.stale ? "Stale — reconnecting" : "Live · 2s"}
          </span>
        </div>
        <span className="spacer" />
        <span className="small">{user.display_name} · <b>{roleLabel(user.role)}</b></span>
        <button className="btn small" onClick={onSignOut}>Sign out</button>
      </header>
      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="tab" onClick={() => setTab(t)}>
            {t}{counts[t] ? <span className="count">{counts[t]}</span> : null}
          </button>
        ))}
      </nav>
      <main>
        {live.error && !r && <div className="notice error" role="alert">Cannot load the report: {live.error}</div>}
        {live.loading && <div className="muted">Loading report…</div>}
        {r && (
          <>
            {tab === "Desk" && <DeskTab r={r} user={user} refresh={live.refresh} goto={setTab as (t: string) => void} />}
            {tab === "Offers" && <OffersTab r={r} user={user} refresh={live.refresh} />}
            {tab === "Network state" && <StateTab r={r} />}
            {tab === "Data & clock" && <DataTab r={r} user={user} refresh={live.refresh} />}
            {tab === "Actions & audit" && <AuditTab r={r} user={user} refresh={live.refresh} />}
            {tab === "Evidence" && <EvidenceTab r={r} fetchMs={live.lastFetchMs} />}
          </>
        )}
      </main>
    </>
  );
}
