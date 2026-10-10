import { useState } from "react";
import { mutate } from "../api";
import { hhmm } from "../format";
import type { Report, Risk, User } from "../types";
import { ForecastChart } from "./Charts";
import { useAction } from "./useAction";
import { CandidateTable } from "./OffersTab";

interface Props {
  r: Report;
  user: User;
  refresh: () => Promise<void>;
  goto: (tab: string) => void;
}

export default function DeskTab({ r, user, refresh, goto }: Props) {
  const act = useAction(refresh);
  const [showAll, setShowAll] = useState(false);
  const st = r.staffing;
  const target = st.target ? r.coverage.hospitals.find((h) => h.hospital_id === st.target!.hospital_id) : undefined;
  const openEsc = new Set(r.actions.filter((a) => a.kind === "escalation" && a.status === "open").map((a) => a.risk_id));
  const risks = showAll ? r.risks : r.risks.slice(0, 12);
  const isCoord = user.role === "coordinator";
  const openOfferFor = (pid: string) =>
    r.offers.find((o) => o.physician_id === pid && ["proposed", "approved", "sent"].includes(o.status));

  const escalate = (risk: Risk) =>
    act.run(`esc:${risk.id}`, () =>
      mutate("/api/v1/actions/escalate", { risk_id: risk.id, consult_id: risk.consult_id, note: risk.detail }),
    () => "Internal escalation created. The clinical lead sees it under Actions & audit.");
  const reassign = (risk: Risk) =>
    act.run(`rsn:${risk.id}`, () =>
      mutate("/api/v1/actions/reassign", { consult_id: risk.consult_id, physician_id: risk.action.target_physician_id }),
    () => `Reassignment of ${risk.consult_id} recorded in the operations model.`);
  const propose = () =>
    act.run("propose", () => mutate<{ offer_ids: string[] }>("/api/v1/offers/propose", {}),
      (res) => `Proposed ${res.result.offer_ids.length} offer(s). Waiting for clinical lead approval.`);

  return (
    <div className="grid desk">
      <section className="card" aria-labelledby="risks-h">
        <div className="card-head">
          <h2 id="risks-h">What needs attention</h2>
          <span className="small muted">{r.risks.length} items · ranked by severity, stroke impact, overage</span>
        </div>
        {act.notice && <div className={`notice ${act.notice.kind}`} role="status" style={{ marginBottom: 8 }}>{act.notice.text}</div>}
        {risks.map((risk) => (
          <article key={risk.id} className="risk">
            <span className="rank">{risk.rank}</span>
            <div>
              <div className="row" style={{ gap: 10 }}>
                <span className={`sev ${risk.severity}`}>{risk.severity}</span>
                <span className="risk-title">{risk.title}</span>
              </div>
              <div className="risk-detail">{risk.detail}</div>
              <div className="risk-action">
                <span className="owner">{risk.action.role === "clinical_lead" ? "Clinical lead" : "Coordinator"} →</span>
                <span>{risk.action.label}</span>
                {risk.action.action === "escalate" && (
                  openEsc.has(risk.id)
                    ? <span className="badge">Escalated</span>
                    : <button className="btn small" disabled={act.busy !== null} onClick={() => escalate(risk)}>Escalate</button>
                )}
                {risk.action.action === "reassign" && isCoord && (
                  <button className="btn small" disabled={act.busy !== null} onClick={() => reassign(risk)}>Record reassignment</button>
                )}
                {risk.action.action === "propose_offer" && (
                  <button className="btn small" onClick={() => goto("Offers")}>Review offer</button>
                )}
              </div>
            </div>
          </article>
        ))}
        {r.risks.length > 12 && (
          <button className="btn small" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 12" : `Show all ${r.risks.length}`}</button>
        )}
      </section>

      <div className="stack">
        <section className="card" aria-labelledby="rec-h">
          <div className="card-head">
            <h2 id="rec-h">Recommended intervention</h2>
            {st.target && <span className="small muted">Target selected by rule: {st.target.reason}</span>}
          </div>
          {!st.target && <div className="notice ok">{st.message ?? "No projected coverage gap."}</div>}
          {st.target && (
            <>
              <div className="metrics" style={{ marginBottom: 12 }}>
                <div className="metric">
                  <div className="label">Target</div>
                  <div className="value" style={{ fontSize: 17 }}>{st.target.hospital_name}</div>
                  <div className="sub">{st.target.trailing_observed} consults last hour vs p90 {st.target.p90}</div>
                </div>
                <div className="metric">
                  <div className="label">Coverage deficit (90 min)</div>
                  <div className="value num">{st.baseline_deficit_minutes} → {st.projected_deficit_minutes}</div>
                  <div className="sub">physician-minutes; not patient wait</div>
                </div>
                <div className="metric">
                  <div className="label">Offer window</div>
                  <div className="value num" style={{ fontSize: 17 }}>{hhmm(st.offer_window?.start)}–{hhmm(st.offer_window?.end)}</div>
                  <div className="sub">{st.slots} slot(s) · residual peak {st.residual_peak_deficit} short</div>
                </div>
              </div>
              {st.selected.length > 0 ? (
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    Offer <b>{st.selected.map((id) => st.candidates.find((c) => c.physician_id === id)?.name).join(", ")}</b>{" "}
                    for {st.gap_hospitals?.join(", ")} only (routing guard).
                  </div>
                  {isCoord
                    ? <button className="btn primary" disabled={act.busy !== null} onClick={propose}>Propose offer</button>
                    : <span className="small muted">Coordinator proposes; you approve.</span>}
                </div>
              ) : (
                <div className="notice warn">
                  {st.message}
                  {st.candidates.filter((c) => openOfferFor(c.physician_id)).map((c) => (
                    <div key={c.physician_id}>{c.name} already has an open offer ({openOfferFor(c.physician_id)!.status}).</div>
                  ))}
                </div>
              )}
              {st.residual_peak_deficit ? (
                <p className="small muted" style={{ marginBottom: 0 }}>
                  A shortage remains even with this offer; immediate escalations stay separate from supplemental staffing.
                </p>
              ) : null}
            </>
          )}
        </section>

        {st.target && (
          <section className="card" aria-labelledby="cand-h">
            <div className="card-head">
              <h2 id="cand-h">Every off-shift physician, every rule</h2>
              <span className="small muted">Eligibility first, then ranking</span>
            </div>
            <CandidateTable candidates={st.candidates} />
          </section>
        )}

        {target && (
          <section className="card" aria-labelledby="fc-h">
            <div className="card-head">
              <h2 id="fc-h">{target.hospital_name}: next 90 minutes</h2>
              <span className="small muted">{target.deficit_minutes} deficit physician-minutes</span>
            </div>
            <ForecastChart hospital={target} />
            <div className="small muted">
              Shift changes:{" "}
              {r.coverage.shift_changes.filter((c) => c.hospitals.includes(target.hospital_id))
                .map((c) => `${c.physician_id} ${c.change} ${hhmm(c.at)}`).join(" · ") || "none"}
            </div>
          </section>
        )}

        <section className="card" aria-labelledby="trap-h">
          <div className="card-head">
            <h2 id="trap-h">Split-shift trap guard</h2>
          </div>
          {r.routing_trap.illustration ? (
            <p style={{ marginTop: 0 }}>
              A joiner starts with zero consults, so routing would put{" "}
              <b>{r.routing_trap.illustration.physician_id}</b> first in line at{" "}
              <b>{r.routing_trap.illustration.first_in_line_without_guard.length} hospitals</b>{" "}
              ({r.routing_trap.illustration.first_in_line_without_guard.join(", ")}). With the guard they are routable only at{" "}
              <b>{r.routing_trap.illustration.first_in_line_with_guard.join(", ") || "their offer hospitals"}</b>.
            </p>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>{r.routing_trap.guard}</p>
          )}
          {r.routing_trap.joiners.length > 0 && (
            <div className="small">
              Active joiners: {r.routing_trap.joiners.map((j) => `${j.physician_id} at ${j.hospitals.join(", ")} from ${hhmm(j.online_at)}`).join("; ")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
