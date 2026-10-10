import { useState } from "react";
import type { Report } from "../types";
import { CoverageHeatmap, ForecastChart } from "./Charts";
import { PhysicianCard } from "./Pulse";

export default function StateTab({ r }: { r: Report }) {
  const [selected, setSelected] = useState<string>(r.staffing.target?.hospital_id ?? r.coverage.hospitals[0].hospital_id);
  const hosp = r.coverage.hospitals.find((h) => h.hospital_id === selected)!;
  const [view, setView] = useState<"cards" | "table">("cards");
  const shown = r.physicians.filter((p) => p.on_roster_shift || p.derived_state !== "Off Shift" || p.planned_capacity);
  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>Coverage projection, all hospitals</h2>
          <span className="small muted">19 samples · 5-min steps · ▲ demand spike · click a hospital for detail</span>
        </div>
        <CoverageHeatmap hospitals={r.coverage.hospitals} onSelect={setSelected} selected={selected} />
      </section>
      <section className="card">
        <div className="card-head"><h2>{hosp.hospital_name}</h2><span className="small muted">{hosp.deficit_minutes} deficit physician-minutes</span></div>
        <ForecastChart hospital={hosp} />
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Physician activity (derived from signals)</h2>
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={view === "cards"} onClick={() => setView("cards")}>Cards</button>
            <button aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button>
          </div>
        </div>
        {view === "cards" && (
          <div className="phys-grid">{shown.map((p) => <PhysicianCard key={p.physician_id} p={p} />)}</div>
        )}
        {view === "table" && <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Physician</th><th>Shift</th><th>Self-reported</th><th>Agent</th><th>Derived state</th>
                <th className="num">Consults</th><th className="num">Calls</th><th className="num">Open</th><th className="num">Min left</th>
                <th>Routable</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.physician_id}>
                  <td><b>{p.physician_id}</b> {p.name}</td><td className="num">{p.shift_et || "—"}</td>
                  <td>{p.self_reported_status}</td><td>{p.desktop_agent}</td><td><b>{p.derived_state}</b></td>
                  <td className="num">{p.consults_this_shift}</td><td className="num">{p.calls_this_shift}</td>
                  <td className="num">{p.open_consults}</td><td className="num">{p.minutes_to_shift_end ?? "—"}</td>
                  <td>{p.routable ? "Yes" : "No"}{p.ringing_consult ? " · ringing" : ""}{p.in_cooldown ? " · cooldown" : ""}</td>
                  <td className="small">
                    {p.flags.join("; ")}
                    {p.planned_capacity && <div>Planned capacity at {p.planned_capacity.hospitals.join(", ")}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </section>
      <section className="card">
        <div className="card-head"><h2>Open consults (lifecycle)</h2><span className="small muted">{r.consults.length} open</span></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Consult</th><th>Hospital</th><th>Type</th><th>Physician</th><th>Stage</th><th>Entered</th>
                <th className="num">Min in stage</th><th className="num">Since received</th><th className="num">Note clock</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {r.consults.map((c) => (
                <tr key={c.consult_id}>
                  <td className="mono">{c.consult_id}</td><td>{c.hospital_name}</td><td>{c.consult_type}</td><td>{c.physician_id}</td>
                  <td>{c.current_stage}</td><td className="num">{c.stage_entered_at}</td>
                  <td className="num">{c.minutes_in_stage}</td><td className="num">{c.minutes_since_received}</td>
                  <td className="num">{c.documentation_clock_min ?? "—"}</td>
                  <td className="small">
                    {c.routing_failures > 0 && <div>Routing failed {c.routing_failures}×</div>}
                    {c.ringing_physician && <div>Ringing to {c.ringing_physician}</div>}
                    {c.modeled_reassignment && <div>Modeled reassignment → {c.modeled_reassignment.target_physician_id}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
