import { useState } from "react";
import { mutate } from "../api";
import { hhmm } from "../format";
import type { Action, Offer, Report, Risk, User } from "../types";
import { ForecastChart } from "./Charts";
import { CandidateList } from "./OffersTab";
import { NetworkPulse } from "./Pulse";
import { useAction } from "./useAction";

interface Props {
  r: Report;
  user: User;
  refresh: () => Promise<void>;
  goto: (tab: string) => void;
}

const OPEN = ["proposed", "approved", "sent"];

export default function DeskTab({ r, user, refresh }: Props) {
  const act = useAction(refresh);
  const st = r.staffing;
  const target = st.target ? r.coverage.hospitals.find((h) => h.hospital_id === st.target!.hospital_id) : undefined;
  const isCoord = user.role === "coordinator";
  const isLead = user.role === "clinical_lead";

  const propose = () =>
    act.run("propose", () => mutate("/api/v1/offers/propose", {}), () => "Offer proposed. Waiting for the clinical lead.");

  const targetOffers = r.offers.filter((o) => st.target && o.hospitals.includes(st.target.hospital_id));
  const liveOffer = [...targetOffers].reverse().find((o) => OPEN.includes(o.status) || o.status === "accepted");
  // Once an offer exists, show the effect it was proposed for (the live recommendation has moved on).
  const before = liveOffer ? Number(liveOffer.rationale.baseline_deficit_minutes) : st.baseline_deficit_minutes;
  const after = liveOffer ? Number(liveOffer.rationale.projected_deficit_minutes_with_selection) : st.projected_deficit_minutes;
  const offerByPhysician = Object.fromEntries(targetOffers.filter((o) => OPEN.includes(o.status) || o.status === "accepted")
    .map((o) => [o.physician_id, o.status]));

  return (
    <>
      <NetworkPulse r={r} />
      {act.notice && <div className={`notice ${act.notice.kind}`} role="status" style={{ marginBottom: 12 }}>{act.notice.text}</div>}
      <div className="grid desk">
        <div className="stack">
          <Queue r={r} user={user} act={act} />
          <RiskList r={r} user={user} act={act} propose={propose} />
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="rec-h">
            <div className="card-head"><h2 id="rec-h">Recommended action</h2></div>
            {!st.target && <p className="muted" style={{ margin: 0 }}>No projected coverage gap. Nothing to staff.</p>}
            {st.target && (
              <>
                <div className="rec">
                  <div>
                    <div className="rec-title">
                      {st.selected.length
                        ? <>Offer <b>{st.candidates.find((c) => c.physician_id === st.selected[0])?.name}</b></>
                        : liveOffer ? <>Offer to <b>{liveOffer.physician_name}</b></> : "No eligible physician"}
                    </div>
                    <div className="muted">
                      {st.target.hospital_name} · {hhmm(st.offer_window?.start)}–{hhmm(st.offer_window?.end)}
                    </div>
                  </div>
                  <div className="rec-metric">
                    <span className="num">{before} → {after}</span>
                    <span className="small muted">gap, physician-min</span>
                  </div>
                </div>
                <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
                  {liveOffer ? <OfferSteps o={liveOffer} /> : st.selected.length === 0
                    ? <span className="tag rose">Escalate: no one eligible</span>
                    : <span className="small muted">Routing guard: joins {st.gap_hospitals?.join(", ")} only</span>}
                  {isCoord && st.selected.length > 0 && !liveOffer && (
                    <button className="btn primary" disabled={act.busy !== null} onClick={propose}>Propose offer</button>
                  )}
                  {isLead && st.selected.length > 0 && !liveOffer && <span className="small muted">Coordinator proposes</span>}
                </div>
              </>
            )}
          </section>

          {st.target && (
            <section className="card" aria-labelledby="cand-h">
              <div className="card-head">
                <h2 id="cand-h">Off-shift physicians</h2>
                <span className="small muted">
                  {liveOffer ? `offer ${liveOffer.status}` : `${st.candidates.filter((c) => c.eligible).length} of ${st.candidates.length} eligible`}
                </span>
              </div>
              <CandidateList candidates={liveOffer ? liveOffer.candidate_audit : st.candidates} offers={offerByPhysician} />
            </section>
          )}

          {target && (
            <section className="card" aria-labelledby="fc-h">
              <div className="card-head">
                <h2 id="fc-h">{target.hospital_name} · next 90 min</h2>
                <span className="small muted">
                  {r.coverage.shift_changes.filter((c) => c.hospitals.includes(target.hospital_id))
                    .map((c) => `${c.physician_id} ${c.change === "ends" ? "off" : "on"} ${hhmm(c.at)}`).join(" · ")}
                </span>
              </div>
              <ForecastChart hospital={target} />
            </section>
          )}

          {r.routing_trap.illustration && (
            <section className="card trap">
              <h2>Split-shift trap: guarded</h2>
              <div className="trap-row">
                <div><span className="big num">{r.routing_trap.illustration.first_in_line_without_guard.length}</span><span className="small muted">hospitals would route to {r.routing_trap.illustration.physician_id} first</span></div>
                <span className="arrow" aria-hidden>→</span>
                <div><span className="big num">{r.routing_trap.illustration.first_in_line_with_guard.length}</span><span className="small muted">with our guard ({r.routing_trap.illustration.first_in_line_with_guard.join(", ")})</span></div>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

type Act = ReturnType<typeof useAction>;

function OfferSteps({ o }: { o: Offer }) {
  const steps = ["proposed", "approved", "sent", "accepted"];
  const at = steps.indexOf(o.status);
  return (
    <div className="steps" aria-label={`Offer ${o.status}`}>
      {steps.map((s, i) => (
        <span key={s} className={`step ${i <= at ? "done" : ""} ${i === at ? "current" : ""}`}>{s}</span>
      ))}
    </div>
  );
}

/** Everything waiting on the signed-in role, with the button to do it. */
function Queue({ r, user, act }: { r: Report; user: User; act: Act }) {
  const offerCall = (o: Offer, action: string, msg: string, body: object = {}) =>
    act.run(`${o.offer_id}:${action}`, () => mutate(`/api/v1/offers/${o.offer_id}/${action}`, body), () => msg);
  const ack = (a: Action) =>
    act.run(a.action_id, () => mutate(`/api/v1/actions/${a.action_id}/acknowledge`, { decision: "Acknowledged" }),
      () => "Escalation acknowledged.");
  const riskTitle = (id: string | null) => r.risks.find((x) => x.id === id)?.title ?? id ?? "";

  const items: JSX.Element[] = [];
  const todo = user.role === "clinical_lead"
    ? r.offers.filter((o) => o.status === "proposed").length + r.actions.filter((a) => a.kind === "escalation" && a.status === "open").length
    : user.role === "coordinator" ? r.offers.filter((o) => o.status === "approved").length : 0;
  if (user.role === "clinical_lead") {
    r.offers.filter((o) => o.status === "proposed").forEach((o) => items.push(
      <div key={o.offer_id} className="q-item">
        <div><b>Approve offer</b> · {o.physician_name}<div className="small muted">{o.hospital_names.join(", ")} · {hhmm(o.window_start)}–{hhmm(o.window_end)}</div></div>
        <div className="row">
          <button className="btn small primary" disabled={act.busy !== null} onClick={() => offerCall(o, "approve", "Approved. Coordinator can send it.")}>Approve</button>
          <button className="btn small" disabled={act.busy !== null} onClick={() => offerCall(o, "reject", "Rejected.", { reason: "Rejected by clinical lead" })}>Reject</button>
        </div>
      </div>));
    r.actions.filter((a) => a.kind === "escalation" && a.status === "open").forEach((a) => items.push(
      <div key={a.action_id} className="q-item">
        <div><b>Escalation</b> · {riskTitle(a.risk_id)}<div className="small muted">from {a.created_by} at {hhmm(a.created_at)}</div></div>
        <button className="btn small primary" disabled={act.busy !== null} onClick={() => ack(a)}>Acknowledge</button>
      </div>));
  } else if (user.role === "coordinator") {
    r.offers.filter((o) => o.status === "approved").forEach((o) => items.push(
      <div key={o.offer_id} className="q-item">
        <div><b>Send offer</b> · {o.physician_name}<div className="small muted">approved by {o.approved_by}</div></div>
        <button className="btn small primary" disabled={act.busy !== null} onClick={() => offerCall(o, "send", "Sent (simulated).")}>Send</button>
      </div>));
    r.offers.filter((o) => o.status === "proposed").forEach((o) => items.push(
      <div key={o.offer_id} className="q-item muted-item">
        <div>Waiting for lead · offer to {o.physician_name}</div>
      </div>));
    r.offers.filter((o) => o.status === "sent").forEach((o) => items.push(
      <div key={o.offer_id} className="q-item muted-item">
        <div>Waiting for {o.physician_name} · expires {hhmm(o.expires_at)}</div>
        <button className="btn small" disabled={act.busy !== null} onClick={() => offerCall(o, "cancel", "Cancelled.", { reason: "Cancelled by coordinator" })}>Cancel</button>
      </div>));
  }
  return (
    <section className="card queue" aria-labelledby="q-h">
      <div className="card-head"><h2 id="q-h">Your queue</h2>{todo > 0 && <span className="tag rose">{todo} to do</span>}</div>
      {items.length ? items : <p className="muted" style={{ margin: 0 }}>Nothing waiting on you.</p>}
    </section>
  );
}

function statusFor(risk: Risk, r: Report): { text: string; tone: string } | null {
  const acts = r.actions.filter((a) => a.risk_id === risk.id || (risk.consult_id && a.consult_id === risk.consult_id && a.kind === "reassignment"));
  const last = acts[acts.length - 1];
  if (last?.kind === "reassignment") return { text: `✓ Reassigned to ${last.target_physician_id}`, tone: "teal" };
  if (last?.kind === "escalation") return last.status === "open"
    ? { text: "Escalated · waiting for lead", tone: "amber" } : { text: "✓ Lead acknowledged", tone: "teal" };
  if (last?.kind === "nudge") return { text: `✓ Nudged ${hhmm(last.created_at)}`, tone: "teal" };
  if (risk.action.action === "propose_offer") {
    const o = [...r.offers].reverse().find((x) => risk.hospital_id && x.hospitals.includes(risk.hospital_id));
    if (o && (OPEN.includes(o.status) || o.status === "accepted")) return { text: `Offer ${o.status}`, tone: o.status === "accepted" ? "teal" : "indigo" };
  }
  return null;
}

function RiskList({ r, user, act, propose }: { r: Report; user: User; act: Act; propose: () => void }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const risks = all ? r.risks : r.risks.slice(0, 8);

  const doAction = (risk: Risk) => {
    const a = risk.action;
    if (a.action === "escalate")
      return act.run(risk.id, () => mutate("/api/v1/actions/escalate", { risk_id: risk.id, consult_id: risk.consult_id, note: risk.title }),
        () => "Escalated. It's now in the clinical lead's queue.");
    if (a.action === "nudge")
      return act.run(risk.id, () => mutate("/api/v1/actions/escalate", {
        risk_id: risk.id, consult_id: risk.consult_id, note: risk.title, kind: "nudge", target_physician_id: a.target_physician_id,
      }), () => `Nudge sent to ${a.target_physician_id} (simulated).`);
    if (a.action === "reassign")
      return act.run(risk.id, () => mutate("/api/v1/actions/reassign", { consult_id: risk.consult_id, physician_id: a.target_physician_id }),
        () => `${risk.consult_id} reassigned to ${a.target_physician_id} (modeled).`);
    if (a.action === "propose_offer") return propose();
  };

  const canDo = (risk: Risk) => {
    const a = risk.action.action;
    if (a === "monitor") return false;
    if (a === "reassign" || a === "propose_offer") return user.role === "coordinator";
    return true;
  };

  return (
    <section className="card" aria-labelledby="risks-h">
      <div className="card-head">
        <h2 id="risks-h">Needs attention</h2>
        <span className="small muted">{r.risks.filter((x) => x.severity === "critical").length} critical · {r.risks.length} total</span>
      </div>
      <ul className="risk-list">
        {risks.map((risk) => {
          const status = statusFor(risk, r);
          return (
            <li key={risk.id} className="risk-row">
              <span className={`sev-dot ${risk.severity}`} title={risk.severity} aria-label={risk.severity} />
              <button className="risk-text" onClick={() => setOpen(open === risk.id ? null : risk.id)} aria-expanded={open === risk.id}>
                <span className="risk-title">{risk.title}</span>
                <span className="risk-summary">{risk.summary}</span>
                {open === risk.id && <span className="risk-why">{risk.detail}. <i>{risk.action.why}.</i></span>}
              </button>
              <span className="risk-cta">
                {status ? <span className={`tag ${status.tone}`}>{status.text}</span>
                  : canDo(risk) ? (
                    <button className={`btn small ${risk.action.action === "escalate" ? "danger" : ""}`} disabled={act.busy !== null}
                      onClick={() => doAction(risk)}>{act.busy === risk.id ? "…" : risk.action.label}</button>
                  ) : <span className="small muted">{risk.action.action === "monitor" ? "Monitoring" : "Coordinator"}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {r.risks.length > 8 && (
        <button className="btn small" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${r.risks.length}`}</button>
      )}
    </section>
  );
}
