import { mutate } from "../api";
import { hhmm } from "../format";
import type { Candidate, Offer, Report, User } from "../types";
import { useAction } from "./useAction";

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
                    {rule.passed ? rule.label.split(" ")[0] + "…" : `${rule.label} — ${rule.detail}`}
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
          <span className="small muted">Propose → clinical lead approves → simulated send → physician answers within 10 min</span>
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
              <summary>Rationale and candidate audit</summary>
              <pre className="mono small" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(o.rationale, null, 2)}</pre>
              <CandidateTable candidates={o.candidate_audit} />
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
          <p className="small muted">A unique (gap, slot) claim in the database guarantees one winner per slot; remaining offers are cancelled when a gap fills.</p>
        </section>
      )}
    </div>
  );
}
