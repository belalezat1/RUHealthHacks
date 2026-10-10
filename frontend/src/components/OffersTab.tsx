import { useState } from "react";
import { mutate } from "../api";
import { hhmm } from "../format";
import type { Candidate, Offer, Report, User } from "../types";
import { useAction } from "./useAction";

const SHORT: Record<string, string> = {
  opt_in: "Opted in", credentialed: "Credentialed", rest: "10h rest", weekly_hours: "≤60h/7d",
  no_schedule_overlap: "No shift overlap", duration: "≥2h offer", no_accepted_overlap: "No accepted overlap",
  one_open_offer: "No open offer", weekly_offer_limit: "<3 offers/wk",
};

export function CandidateTable({ candidates }: { candidates: Candidate[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Physician</th><th>Result</th><th>Rules (✓ pass · ✗ fail)</th><th className="num">To online</th><th className="num">Gap min removed</th></tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.physician_id} className={c.selected ? "selected" : ""}>
              <td><b>{c.name}</b><div className="small muted">{c.physician_id} · {c.role}</div></td>
              <td>
                {c.eligible
                  ? <span className="badge ok">✓ Eligible{c.selected ? " · selected" : ""}</span>
                  : <span className="badge bad">✗ Excluded</span>}
              </td>
              <td>
                {c.rules.map((rule) => (
                  <span key={rule.rule} className={`rule ${rule.passed ? "pass" : "fail"}`} title={`${rule.label}: ${rule.detail}`}>
                    <span className="mark" aria-label={rule.passed ? "pass" : "fail"}>{rule.passed ? "✓" : "✗"}</span>
                    {rule.passed ? SHORT[rule.rule] ?? rule.label : `${SHORT[rule.rule] ?? rule.label}: ${rule.detail}`}
                  </span>
                ))}
                <details><summary className="small">All rule details</summary>
                  <ul className="small" style={{ margin: "4px 0", paddingLeft: 18 }}>
                    {c.rules.map((rule) => <li key={rule.rule}>{rule.passed ? "✓" : "✗"} {rule.label}: {rule.detail}</li>)}
                  </ul>
                </details>
              </td>
              <td className="num">{c.minutes_to_online} min</td>
              <td className="num">{c.deficit_minutes_removed ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FAIL: Record<string, string> = {
  opt_in: "Not opted in", credentialed: "Not credentialed here", rest: "Under 10h rest", weekly_hours: "Over 60h/7d",
  no_schedule_overlap: "Overlaps a scheduled shift", duration: "Under 2h", no_accepted_overlap: "Already committed",
  one_open_offer: "Has an open offer", weekly_offer_limit: "3 offers this week",
};
const WITH_DETAIL = new Set(["weekly_hours", "rest"]);

/** Compact version for the Desk: one line per physician, rules on demand. */
export function CandidateList({ candidates, offers = {} }: { candidates: Candidate[]; offers?: Record<string, string> }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...candidates].sort((a, b) => Number(b.eligible) - Number(a.eligible) || (a.rank ?? 99) - (b.rank ?? 99));
  return (
    <ul className="cand-list">
      {sorted.map((c) => {
        const failed = c.rules.filter((x) => !x.passed);
        const offer = offers[c.physician_id];
        const ok = c.eligible || !!offer;
        return (
          <li key={c.physician_id} className={c.selected ? "selected" : ""}>
            <button className="cand-row" onClick={() => setOpen(open === c.physician_id ? null : c.physician_id)}
              aria-expanded={open === c.physician_id}>
              <span className={`cand-mark ${ok ? "ok" : "bad"}`} aria-label={ok ? "eligible" : "excluded"}>
                {ok ? "✓" : "✗"}
              </span>
              <span className="cand-name">{c.name}</span>
              <span className="cand-why">
                {offer ? `Offer ${offer} · online in ${c.minutes_to_online} min`
                  : c.eligible ? `All ${c.rules.length} rules pass · online in ${c.minutes_to_online} min`
                  : failed.map((x) => (FAIL[x.rule] ?? x.label) + (WITH_DETAIL.has(x.rule) ? ` (${x.detail})` : "")).join(" · ")}
              </span>
              {offer ? <span className={`tag ${offer === "accepted" ? "teal" : "indigo"}`}>{offer}</span>
                : c.selected && <span className="tag teal">Selected</span>}
            </button>
            {open === c.physician_id && (
              <div className="cand-rules">
                {c.rules.map((rule) => (
                  <span key={rule.rule} className={`rule ${rule.passed ? "pass" : "fail"}`} title={rule.label}>
                    <span className="mark">{rule.passed ? "✓" : "✗"}</span>{SHORT[rule.rule] ?? rule.label}: {rule.detail}
                  </span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const STEPS = ["proposed", "approved", "sent", "accepted"] as const;

function Pipeline({ o }: { o: Offer }) {
  const terminal = ["rejected", "declined", "expired", "cancelled"].includes(o.status);
  const reached = terminal ? -1 : STEPS.indexOf(o.status as (typeof STEPS)[number]);
  return (
    <div className="row small" aria-label={`Offer status ${o.status}`}>
      {STEPS.map((s, i) => (
        <span key={s} className="badge" style={{ opacity: terminal || i > reached ? 0.45 : 1, fontWeight: i === reached ? 700 : 500 }}>
          {i <= reached ? "✓ " : ""}{s}
        </span>
      ))}
      {terminal && <span className={`badge status-${o.status}`}>✗ {o.status}{o.status_reason ? `: ${o.status_reason}` : ""}</span>}
    </div>
  );
}

export default function OffersTab({ r, user, refresh }: { r: Report; user: User; refresh: () => Promise<void> }) {
  const act = useAction(refresh);
  const isLead = user.role === "clinical_lead";
  const isCoord = user.role === "coordinator";
  const call = (o: Offer, action: string, body: object = {}, msg = "") =>
    act.run(`${o.offer_id}:${action}`, () => mutate(`/api/v1/offers/${o.offer_id}/${action}`, body), () => msg || `Offer ${action} done.`);

  const offers = [...r.offers].reverse();
  return (
    <div className="stack">
      {act.notice && <div className={`notice ${act.notice.kind}`} role="status">{act.notice.text}</div>}
      <section className="card">
        <div className="card-head">
          <h2>Split-shift offers</h2>
          <span className="small muted">Propose → approve → send → answer (10 min)</span>
        </div>
        {offers.length === 0 && <p className="muted">No offers yet. Propose one from the Desk.</p>}
        {offers.map((o) => (
          <article key={o.offer_id} className="audit-item" style={{ padding: "12px 0" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <b>{o.physician_name}</b> <span className="muted">({o.physician_id})</span> · {o.hospital_names.join(", ")} ·{" "}
                {hhmm(o.window_start)}–{hhmm(o.window_end)} ET
                <div className="small muted mono">{o.offer_id} · gap {o.gap_id}</div>
              </div>
              <div className="row">
                {isLead && o.status === "proposed" && (
                  <>
                    <button className="btn small primary" disabled={act.busy !== null} onClick={() => call(o, "approve", {}, "Approved. The coordinator can now send it.")}>Approve</button>
                    <button className="btn small danger" disabled={act.busy !== null} onClick={() => call(o, "reject", { reason: "Rejected by clinical lead" }, "Rejected.")}>Reject</button>
                  </>
                )}
                {isLead && o.status === "approved" && (
                  <button className="btn small danger" disabled={act.busy !== null} onClick={() => call(o, "reject", { reason: "Approval withdrawn" }, "Approval withdrawn.")}>Withdraw approval</button>
                )}
                {isCoord && o.status === "approved" && (
                  <button className="btn small primary" disabled={act.busy !== null} onClick={() => call(o, "send", {}, "Sent (simulated). No real message was delivered.")}>Send (simulated)</button>
                )}
                {isCoord && o.status === "proposed" && <span className="small muted">Awaiting clinical lead</span>}
                {["proposed", "approved", "sent"].includes(o.status) && (
                  <button className="btn small" disabled={act.busy !== null} onClick={() => call(o, "cancel", { reason: `Cancelled by ${user.role}` }, "Cancelled.")}>Cancel</button>
                )}
              </div>
            </div>
            <Pipeline o={o} />
            <div className="small" style={{ marginTop: 4 }}>
              {o.approved_by && <>Approved by <b>{o.approved_by}</b>. </>}
              {o.sent_at && <>Sent {hhmm(o.sent_at)}, expires {hhmm(o.expires_at)} ET. </>}
              {o.online_at && <>Planned online {hhmm(o.online_at)} ET (planned capacity, not verified presence). </>}
            </div>
            <details>
              <summary>Why this offer · who else was considered</summary>
              <p className="small" style={{ margin: "6px 0" }}>
                Gap {String(o.rationale.baseline_deficit_minutes)} → {String(o.rationale.projected_deficit_minutes_with_selection)} physician-min
                over 90 min. Approved by {o.approved_by ?? "—"}.
              </p>
              <CandidateList candidates={o.candidate_audit} />
            </details>
          </article>
        ))}
      </section>
      {r.gaps.length > 0 && (
        <section className="card">
          <h2 style={{ marginBottom: 8 }}>Capacity gaps and slot claims</h2>
          <table>
            <thead><tr><th>Gap</th><th>Hospitals</th><th>Window</th><th className="num">Slots</th><th>Claims</th><th>Status</th></tr></thead>
            <tbody>
              {r.gaps.map((g) => (
                <tr key={g.gap_id}>
                  <td className="mono">{g.gap_id}</td><td>{g.hospitals.join(", ")}</td>
                  <td>{hhmm(g.window_start)}–{hhmm(g.window_end)}</td><td className="num">{g.slots}</td>
                  <td>{g.claims.map((c) => `#${c.slot} ${c.offer_id}`).join(", ") || "—"}</td><td>{g.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">One winner per slot, enforced by the database. Other offers cancel when the gap fills.</p>
        </section>
      )}
    </div>
  );
}
